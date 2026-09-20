"""
Live representation steering for the "Inside the Model" explainer.

One call computes an entire scenario: all nine alpha states, each with the real next-token
distribution and the continuation the steered model actually generates. The page therefore makes
one request per scenario rather than one per slider move, and the slider stays instant and local
once the results arrive.

Deployed as a Gradio Space on ZeroGPU. `steering_core.py` and `steering_scenarios.py` are copied
verbatim from the site repository by `scripts/build-space.sh`, so the Space and the offline
measurement pipeline produce identical numbers.
"""

import json
import os
import threading
import time
import traceback

import gradio as gr
import torch

from steering_core import ALPHAS, load_model, measure_states, num_layers, steering_vector, to_payload
from steering_scenarios import SCENARIOS

MODEL_ID = os.environ.get("MODEL_ID", "Qwen/Qwen2.5-0.5B-Instruct")
MAX_NEW_TOKENS = int(os.environ.get("MAX_NEW_TOKENS", "28"))

# Greedy decoding over fixed prompts and a fixed alpha grid is deterministic: a scenario produces
# byte-identical output every time it runs. Recomputing it per visitor spends ZeroGPU quota - which
# is charged per caller, so it is the visitor's own allowance - to learn nothing new. Results are
# therefore cached in the process and re-derived only when they age out or are explicitly asked for.
CACHE_TTL_SECONDS = float(os.environ.get("CACHE_TTL_SECONDS", "900"))

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


# ZeroGPU wants the model on cuda at import time even though a real GPU only exists inside a
# @GPU call: placement happens against its CUDA emulation and the transfer is optimised for it.
# torch.cuda.is_available() is False out there, so the decision is made by runtime, not probe.
DEVICE = "cuda" if (ON_ZEROGPU or torch.cuda.is_available()) else "cpu"

TOKENIZER, MODEL = load_model(MODEL_ID, device=DEVICE)
DEPTH = num_layers(MODEL)
BY_ID = {spec.id: spec for spec in SCENARIOS}

# Steering directions are deterministic given the model, so they are computed once and reused.
_VECTORS: dict = {}

# scenario id -> (unix timestamp, payload). Guarded because Gradio serves requests concurrently.
_CACHE: dict = {}
_CACHE_LOCK = threading.Lock()


def _vector(spec, layer: int) -> torch.Tensor:
    key = (spec.id, layer)
    if key not in _VECTORS:
        _VECTORS[key] = steering_vector(
            TOKENIZER, MODEL, spec.prompt, spec.prefix,
            spec.negative_examples, spec.positive_examples, layer,
        ).detach().cpu()
    return _VECTORS[key].to(MODEL.device)


# 40s is comfortably above what a scenario actually takes on a Blackwell GPU. Declaring a tighter
# bound than the 60s default improves queue priority for everyone waiting on this Space.
@GPU(duration=40)
def _measure(scenario_id: str) -> dict:
    """Runs the model. The only function that touches a GPU, so the only one that costs quota."""
    spec = BY_ID[scenario_id]
    layer = min(spec.layer, DEPTH)
    states = measure_states(
        TOKENIZER, MODEL, spec.prompt, spec.prefix, _vector(spec, layer), layer,
        scale=spec.scale, alphas=ALPHAS, generate=True,
        max_new_tokens=MAX_NEW_TOKENS, top_k=512,
    )
    payload = to_payload(spec, states, layer, spec.scale)
    payload["model"] = MODEL_ID
    payload["device"] = str(MODEL.device)
    return payload


def _serve(scenario_id: str, force: bool) -> str:
    """Cache-aware wrapper. Deliberately NOT GPU-decorated: a cache hit allocates nothing."""
    try:
        spec = BY_ID.get((scenario_id or "").strip())
        if spec is None:
            return json.dumps({"error": f"unknown scenario {scenario_id!r}",
                               "known": sorted(BY_ID)}, ensure_ascii=False)

        now = time.time()
        with _CACHE_LOCK:
            cached = _CACHE.get(spec.id)

        if cached and not force and (now - cached[0]) < CACHE_TTL_SECONDS:
            return json.dumps(
                {**cached[1], "cached": True, "age_seconds": round(now - cached[0], 1)},
                ensure_ascii=False,
            )

        try:
            payload = _measure(spec.id)
        except Exception as error:
            traceback.print_exc()
            # A fresh run can fail because the caller is out of ZeroGPU quota. Serving a stale but
            # real measurement beats serving an error: the numbers would have been identical.
            with _CACHE_LOCK:
                cached = _CACHE.get(spec.id)
            if cached:
                return json.dumps(
                    {**cached[1], "cached": True, "stale": True,
                     "age_seconds": round(time.time() - cached[0], 1),
                     "note": f"{type(error).__name__}: {error}"},
                    ensure_ascii=False,
                )
            return json.dumps({"error": f"{type(error).__name__}: {error}"}, ensure_ascii=False)

        with _CACHE_LOCK:
            _CACHE[spec.id] = (time.time(), payload)
        return json.dumps({**payload, "cached": False, "age_seconds": 0.0}, ensure_ascii=False)

    except Exception as error:  # never return an HTML error page to the browser client
        traceback.print_exc()
        return json.dumps({"error": f"{type(error).__name__}: {error}"}, ensure_ascii=False)


def run_scenario(scenario_id: str) -> str:
    """Measures one scenario across all nine alpha states, cached. Returns JSON as a string."""
    return _serve(scenario_id, force=False)


def run_scenario_fresh(scenario_id: str) -> str:
    """Forces a real GPU run, ignoring the cache. Separate endpoint so the arity stays stable."""
    return _serve(scenario_id, force=True)


def list_scenarios() -> str:
    return json.dumps(
        {
            "model": MODEL_ID,
            "layers": DEPTH,
            "alphas": ALPHAS,
            "scenarios": [
                {"id": s.id, "title": s.title, "layer": min(s.layer, DEPTH), "coefficient": s.scale}
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

Model: `{MODEL_ID}` · {DEPTH} decoder layers.
One call returns all nine alpha states for a scenario: the real next-token distribution after
the fixed prefix, and the continuation the steered model actually generates with greedy decoding.

The intervention is `h' = h + alpha * coefficient * v`, where `v` is a difference of means over
contrastive continuations, added to the residual stream at one decoder layer.

Greedy decoding over a fixed prompt is deterministic, so results are cached for
{CACHE_TTL_SECONDS:.0f}s and a cache hit costs no GPU time at all. `run_scenario_fresh` forces a
real run.
"""
    )
    with gr.Row():
        scenario_input = gr.Textbox(label="scenario_id", value=SCENARIOS[0].id)
        run_button = gr.Button("Run scenario", variant="primary")
    output = gr.Textbox(label="result (JSON)", lines=18)
    run_button.click(run_scenario, inputs=scenario_input, outputs=output, api_name="run_scenario")

    fresh_button = gr.Button("Recompute on the GPU (ignores the cache)")
    fresh_button.click(
        run_scenario_fresh, inputs=scenario_input, outputs=output, api_name="run_scenario_fresh"
    )

    catalogue_button = gr.Button("List scenarios")
    catalogue = gr.Textbox(label="scenarios (JSON)", lines=8)
    catalogue_button.click(list_scenarios, inputs=None, outputs=catalogue, api_name="scenarios")

demo.queue(max_size=24).launch()
