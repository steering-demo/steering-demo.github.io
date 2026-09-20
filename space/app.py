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
import traceback

import gradio as gr
import torch

from steering_core import ALPHAS, load_model, measure_states, num_layers, steering_vector, to_payload
from steering_scenarios import SCENARIOS

MODEL_ID = os.environ.get("MODEL_ID", "Qwen/Qwen2.5-0.5B-Instruct")
MAX_NEW_TOKENS = int(os.environ.get("MAX_NEW_TOKENS", "28"))

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


def _vector(spec, layer: int) -> torch.Tensor:
    key = (spec.id, layer)
    if key not in _VECTORS:
        _VECTORS[key] = steering_vector(
            TOKENIZER, MODEL, spec.prompt, spec.prefix,
            spec.negative_examples, spec.positive_examples, layer,
        ).detach().cpu()
    return _VECTORS[key].to(MODEL.device)


@GPU(duration=90)
def run_scenario(scenario_id: str) -> str:
    """Measures one scenario across all nine alpha states. Returns JSON as a string."""
    try:
        spec = BY_ID.get((scenario_id or "").strip())
        if spec is None:
            return json.dumps({"error": f"unknown scenario {scenario_id!r}",
                               "known": sorted(BY_ID)}, ensure_ascii=False)

        layer = min(spec.layer, DEPTH)
        states = measure_states(
            TOKENIZER, MODEL, spec.prompt, spec.prefix, _vector(spec, layer), layer,
            scale=spec.scale, alphas=ALPHAS, generate=True,
            max_new_tokens=MAX_NEW_TOKENS, top_k=512,
        )
        payload = to_payload(spec, states, layer, spec.scale)
        payload["model"] = MODEL_ID
        payload["device"] = str(MODEL.device)
        return json.dumps(payload, ensure_ascii=False)
    except Exception as error:  # never return an HTML error page to the browser client
        traceback.print_exc()
        return json.dumps({"error": f"{type(error).__name__}: {error}"}, ensure_ascii=False)


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
"""
    )
    with gr.Row():
        scenario_input = gr.Textbox(label="scenario_id", value=SCENARIOS[0].id)
        run_button = gr.Button("Run scenario", variant="primary")
    output = gr.Textbox(label="result (JSON)", lines=18)
    run_button.click(run_scenario, inputs=scenario_input, outputs=output, api_name="run_scenario")

    catalogue_button = gr.Button("List scenarios")
    catalogue = gr.Textbox(label="scenarios (JSON)", lines=8)
    catalogue_button.click(list_scenarios, inputs=None, outputs=catalogue, api_name="scenarios")

demo.queue(max_size=24).launch()
