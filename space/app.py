"""
Live representation steering for the "Inside the Model" explainer.

One call computes an entire scenario: all nine alpha states, each with the real next-token
distribution and the continuation the steered model actually generates. The page therefore makes
one request per run rather than one per slider move, and the slider stays instant and local once
the results arrive.

Greedy decoding over a fixed prompt is deterministic, so results are cached per
(model, scenario) and a cache hit allocates no GPU at all. Only `_measure` is GPU-decorated, so
only a real measurement spends the caller's ZeroGPU quota.

Deployed as a Gradio Space on ZeroGPU. `steering_core.py` and `steering_scenarios.py` are copied
verbatim from the site repository by `scripts/build-space.sh`, so the Space and the offline
measurement pipeline produce identical numbers.
"""

import hashlib
import json
import os
import threading
import time
import traceback
from dataclasses import replace

import gradio as gr
import torch

from steering_core import ALPHAS, load_model, measure_states, num_layers, steering_vector, to_payload
from steering_scenarios import SCENARIOS, tuning_for

try:
    from spaces import GPU  # ZeroGPU runtime: requests a GPU for the duration of the call

    ON_ZEROGPU = True
except ImportError:  # running locally, or on plain CPU hardware
    ON_ZEROGPU = False

    def GPU(*args, **kwargs):
        """No-op stand-in, so the same file runs anywhere."""
        if len(args) == 1 and callable(args[0]) and not kwargs:
            return args[0]

        def decorate(function):
            return function

        return decorate


# Models the Space will serve. Small on purpose: they load in seconds and steer legibly.
# Override with the MODELS variable, as a comma-separated list of Hugging Face ids.
DEFAULT_MODELS = [
    "Qwen/Qwen2.5-0.5B-Instruct",
    "HuggingFaceTB/SmolLM2-135M-Instruct",
]
MODEL_IDS = [m.strip() for m in os.environ.get("MODELS", ",".join(DEFAULT_MODELS)).split(",") if m.strip()]
DEFAULT_MODEL = os.environ.get("MODEL_ID", MODEL_IDS[0])
if DEFAULT_MODEL not in MODEL_IDS:
    MODEL_IDS.insert(0, DEFAULT_MODEL)

MAX_NEW_TOKENS = int(os.environ.get("MAX_NEW_TOKENS", "28"))
CACHE_TTL_SECONDS = float(os.environ.get("CACHE_TTL_SECONDS", "900"))

# Limits for visitor-supplied text. Generous enough for a sentence, small enough that one run
# stays well inside a single GPU allocation.
MAX_PROMPT_CHARS = 300
MAX_PREFIX_CHARS = 100

# ZeroGPU wants models on cuda at import time even though a real GPU only exists inside a @GPU
# call: placement happens against its CUDA emulation and the transfer is optimised for it.
# torch.cuda.is_available() is False out there, so the decision is made by runtime, not probe.
DEVICE = "cuda" if (ON_ZEROGPU or torch.cuda.is_available()) else "cpu"

MODELS: dict = {}
for _model_id in MODEL_IDS:
    try:
        MODELS[_model_id] = load_model(_model_id, device=DEVICE)
        print(f"loaded {_model_id} ({num_layers(MODELS[_model_id][1])} layers)")
    except Exception:  # a model that will not load must not take the whole Space down
        traceback.print_exc()
        print(f"SKIPPING {_model_id}: failed to load")
if not MODELS:
    raise RuntimeError("no models could be loaded")
if DEFAULT_MODEL not in MODELS:
    DEFAULT_MODEL = next(iter(MODELS))

BY_ID = {spec.id: spec for spec in SCENARIOS}

# Steering directions and measurements are deterministic, so both are computed once and reused.
_VECTORS: dict = {}
_CACHE: dict = {}
_CACHE_LOCK = threading.Lock()


def _resolve_model(model_id: str):
    chosen = (model_id or "").strip() or DEFAULT_MODEL
    if chosen not in MODELS:
        chosen = DEFAULT_MODEL
    tokenizer, model = MODELS[chosen]
    return chosen, tokenizer, model


def _vector(tokenizer, model, key, prompt, prefix, spec, layer) -> torch.Tensor:
    cached = _VECTORS.get(key)
    if cached is None:
        cached = steering_vector(
            tokenizer, model, prompt, prefix,
            spec.negative_examples, spec.positive_examples, layer,
        ).detach().cpu()
        _VECTORS[key] = cached
    return cached.to(model.device)


# 45s is comfortably above what a run actually takes on a Blackwell GPU. Declaring a tighter bound
# than the 60s default improves queue priority for everyone waiting on this Space.
@GPU(duration=45)
def _measure(model_id: str, scenario_id: str, prompt: str, prefix: str) -> dict:
    """Runs the model. The only function that touches a GPU, so the only one that costs quota."""
    model_id, tokenizer, model = _resolve_model(model_id)
    spec = BY_ID[scenario_id]
    depth = num_layers(model)
    layer, scale = tuning_for(model_id, spec, depth)

    custom = prompt != spec.prompt or prefix != spec.prefix
    key = (model_id, spec.id, layer, prompt, prefix)
    vector = _vector(tokenizer, model, key, prompt, prefix, spec, layer)

    states = measure_states(
        tokenizer, model, prompt, prefix, vector, layer,
        scale=scale, alphas=ALPHAS, generate=True,
        max_new_tokens=MAX_NEW_TOKENS, top_k=512,
    )
    shown = replace(spec, prompt=prompt, prefix=prefix)
    if custom:
        shown = replace(
            shown,
            title="Your prompt",
            takeaway=f"Your prompt, steered along the {spec.title} direction.",
        )
    payload = to_payload(shown, states, layer, scale)
    payload["model"] = model_id
    payload["device"] = str(model.device)
    payload["direction"] = spec.id
    payload["direction_title"] = spec.title
    payload["custom"] = custom
    return payload


def _cache_key(model_id: str, scenario_id: str, prompt: str, prefix: str) -> str:
    digest = hashlib.sha1(f"{prompt}\x00{prefix}".encode("utf8")).hexdigest()[:16]
    return f"{model_id}|{scenario_id}|{digest}"


def _serve(model_id: str, scenario_id: str, prompt: str, prefix: str, force: bool) -> str:
    """Cache-aware wrapper. Deliberately NOT GPU-decorated: a cache hit allocates nothing."""
    try:
        spec = BY_ID.get((scenario_id or "").strip())
        if spec is None:
            return json.dumps(
                {"error": f"unknown scenario {scenario_id!r}", "known": sorted(BY_ID)},
                ensure_ascii=False,
            )

        prompt = " ".join((prompt or spec.prompt).split()).strip() or spec.prompt
        prefix = " ".join((prefix or spec.prefix).split()).strip() or spec.prefix
        if len(prompt) > MAX_PROMPT_CHARS:
            return json.dumps({"error": f"prompt is longer than {MAX_PROMPT_CHARS} characters"})
        if len(prefix) > MAX_PREFIX_CHARS:
            return json.dumps({"error": f"prefix is longer than {MAX_PREFIX_CHARS} characters"})

        model_id, _, _ = _resolve_model(model_id)
        key = _cache_key(model_id, spec.id, prompt, prefix)
        now = time.time()
        with _CACHE_LOCK:
            cached = _CACHE.get(key)

        if cached and not force and (now - cached[0]) < CACHE_TTL_SECONDS:
            return json.dumps(
                {**cached[1], "cached": True, "age_seconds": round(now - cached[0], 1)},
                ensure_ascii=False,
            )

        try:
            payload = _measure(model_id, spec.id, prompt, prefix)
        except Exception as error:
            traceback.print_exc()
            # A fresh run can fail because the caller is out of ZeroGPU quota. Serving a stale but
            # real measurement beats serving an error: the numbers would have been identical.
            with _CACHE_LOCK:
                cached = _CACHE.get(key)
            if cached:
                return json.dumps(
                    {**cached[1], "cached": True, "stale": True,
                     "age_seconds": round(time.time() - cached[0], 1),
                     "note": f"{type(error).__name__}: {error}"},
                    ensure_ascii=False,
                )
            return json.dumps({"error": f"{type(error).__name__}: {error}"}, ensure_ascii=False)

        with _CACHE_LOCK:
            _CACHE[key] = (time.time(), payload)
        return json.dumps({**payload, "cached": False, "age_seconds": 0.0}, ensure_ascii=False)

    except Exception as error:  # never return an HTML error page to the browser client
        traceback.print_exc()
        return json.dumps({"error": f"{type(error).__name__}: {error}"}, ensure_ascii=False)


def run_scenario(scenario_id: str) -> str:
    """Default model, cached. Kept at one argument for older clients."""
    return _serve(DEFAULT_MODEL, scenario_id, "", "", force=False)


def run_scenario_fresh(scenario_id: str) -> str:
    """Default model, ignoring the cache."""
    return _serve(DEFAULT_MODEL, scenario_id, "", "", force=True)


def run_model(scenario_id: str, model_id: str, force: str = "") -> str:
    """A scenario on a chosen model."""
    wants_fresh = str(force).strip().lower() in ("1", "true", "yes", "force", "on")
    return _serve(model_id, scenario_id, "", "", force=wants_fresh)


def run_custom(prompt: str, prefix: str, direction_id: str, model_id: str) -> str:
    """
    A visitor's own prompt, steered along an existing scenario's direction.

    The direction still comes from that scenario's contrast examples, but it is re-derived in the
    context of the supplied prompt and prefix, so it is measured where the model actually is when
    it answers this question.
    """
    return _serve(model_id, direction_id, prompt, prefix, force=False)


def catalogue() -> str:
    return json.dumps(
        {
            "models": [
                {"id": mid, "layers": num_layers(MODELS[mid][1]), "default": mid == DEFAULT_MODEL}
                for mid in MODELS
            ],
            "alphas": ALPHAS,
            "limits": {"prompt": MAX_PROMPT_CHARS, "prefix": MAX_PREFIX_CHARS},
            "scenarios": [
                {"id": s.id, "title": s.title, "prompt": s.prompt, "prefix": s.prefix,
                 "negative_label": s.negative_label, "positive_label": s.positive_label}
                for s in SCENARIOS
            ],
        },
        ensure_ascii=False,
    )


with gr.Blocks(title="Steering showcase API") as demo:
    gr.Markdown(
        f"""
# Steering showcase — live API

Backs the interactive explainer **Inside the Model: Steering Its Next Move**.

Models: {", ".join(f"`{m}`" for m in MODELS)}.
One call returns all nine alpha states: the real next-token distribution after the fixed prefix,
and the continuation the steered model actually generates with greedy decoding.

The intervention is `h' = h + alpha * coefficient * v`, where `v` is a difference of means over
contrastive continuations, added to the residual stream at one decoder layer.

Results are cached for {CACHE_TTL_SECONDS:.0f}s and a cache hit costs no GPU time at all.
"""
    )
    with gr.Row():
        scenario_input = gr.Textbox(label="scenario_id", value=SCENARIOS[0].id)
        model_input = gr.Textbox(label="model_id", value=DEFAULT_MODEL)
        force_input = gr.Textbox(label="force", value="")
    run_button = gr.Button("Run scenario", variant="primary")
    output = gr.Textbox(label="result (JSON)", lines=16)

    run_button.click(run_model, inputs=[scenario_input, model_input, force_input],
                     outputs=output, api_name="run_model")
    gr.Button("Run scenario (default model, cached)").click(
        run_scenario, inputs=scenario_input, outputs=output, api_name="run_scenario")
    gr.Button("Recompute on the GPU").click(
        run_scenario_fresh, inputs=scenario_input, outputs=output, api_name="run_scenario_fresh")

    gr.Markdown("### Your own prompt, steered along an existing direction")
    with gr.Row():
        prompt_input = gr.Textbox(label="prompt", value=SCENARIOS[0].prompt)
        prefix_input = gr.Textbox(label="prefix", value=SCENARIOS[0].prefix)
    gr.Button("Run custom prompt").click(
        run_custom, inputs=[prompt_input, prefix_input, scenario_input, model_input],
        outputs=output, api_name="run_custom")

    gr.Button("Catalogue").click(catalogue, inputs=None, outputs=gr.Textbox(label="catalogue"),
                                 api_name="catalogue")

demo.queue(max_size=24).launch()
