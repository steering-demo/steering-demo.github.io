"""
Representation steering, shared by the offline measurement script and the live Space.

The intervention is the one the page describes: derive a direction v from contrastive examples,
then add alpha * v to the residual stream at one layer while the model runs.

    v = mean(activations | positive examples) - mean(activations | negative examples)
    h' = h + alpha * scale * v

Nothing here is specific to a hosting environment, so the Space and the offline pipeline
produce identical numbers from identical inputs.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

ALPHAS: List[float] = [-2.0, -1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 2.0]

#: Commit pinned per model, so a measurement can be reproduced against the same weights even if
#: the repository moves. Unlisted models resolve to `main`, which is not reproducible.
REVISIONS: Dict[str, str] = {
    "Qwen/Qwen2.5-0.5B-Instruct": "7ae557604adf67be50417f59c2c2f167def9a775",
    "HuggingFaceTB/SmolLM2-135M-Instruct": "12fd25f77366fa6b3b4b768ec3050bf629380bac",
}


def load_model(model_id: str, device: str = "cpu", dtype: Optional[torch.dtype] = None):
    """Loads a causal LM for inference. Deterministic: eval mode, no sampling anywhere."""
    revision = REVISIONS.get(model_id, "main")
    tokenizer = AutoTokenizer.from_pretrained(model_id, revision=revision)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        revision=revision,
        dtype=dtype or torch.float32,
        attn_implementation="eager",
    )
    model.to(device)
    model.eval()
    return tokenizer, model


def decoder_layers(model) -> torch.nn.ModuleList:
    """The decoder block list, across the architectures we might use."""
    for path in ("model.layers", "transformer.h", "model.decoder.layers", "gpt_neox.layers"):
        node = model
        for part in path.split("."):
            node = getattr(node, part, None)
            if node is None:
                break
        if isinstance(node, torch.nn.ModuleList):
            return node
    raise RuntimeError(f"Could not find decoder layers on {type(model).__name__}")


def num_layers(model) -> int:
    return len(decoder_layers(model))


def build_context(tokenizer, prompt: str, prefix: str) -> List[int]:
    """
    Token ids for the fixed prompt plus the fixed response prefix.

    Instruct models get their chat template so the measurement happens in the distribution the
    model was tuned for; a base model just gets the raw text.
    """
    if getattr(tokenizer, "chat_template", None):
        chat = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            tokenize=False,
            add_generation_prompt=True,
        )
    else:
        chat = f"{prompt}\n"
    return tokenizer(chat + prefix, add_special_tokens=False).input_ids


class SteeringHook:
    """Adds alpha * vector to a decoder block's output hidden states, at every position."""

    def __init__(self, vector: torch.Tensor):
        self.vector = vector
        self.alpha = 0.0

    def __call__(self, module, args, output):
        if self.alpha == 0.0:
            return output
        delta = self.alpha * self.vector
        if isinstance(output, tuple):
            return (output[0] + delta,) + output[1:]
        return output + delta


@torch.no_grad()
def steering_vector(
    tokenizer,
    model,
    prompt: str,
    prefix: str,
    negative_examples: Sequence[str],
    positive_examples: Sequence[str],
    layer: int,
) -> torch.Tensor:
    """
    Difference of means between the two example sets, at `layer`.

    Each example is measured in place: the model sees the scenario's own prompt and prefix and
    then the example continuation, and we average the hidden states over the continuation
    tokens only. The direction is therefore estimated where the model actually is when it
    answers, not in some unrelated context.

    `layer` indexes `hidden_states`, so layer 1 is the output of the first decoder block.
    """
    base = build_context(tokenizer, prompt, prefix)

    def mean_activation(examples: Sequence[str]) -> torch.Tensor:
        collected = []
        for example in examples:
            continuation = tokenizer(example, add_special_tokens=False).input_ids
            ids = torch.tensor([base + continuation], device=model.device)
            hidden = model(ids, output_hidden_states=True).hidden_states[layer]
            collected.append(hidden[0, len(base) :, :].float().mean(dim=0))
        return torch.stack(collected).mean(dim=0)

    return mean_activation(positive_examples) - mean_activation(negative_examples)


def _stop_token_ids(tokenizer, model) -> set:
    """Every token id that would end generation, from both the tokenizer and the model config."""
    found = set()
    for source in (getattr(tokenizer, "eos_token_id", None),
                   getattr(getattr(model, "generation_config", None), "eos_token_id", None)):
        if source is None:
            continue
        found.update(source if isinstance(source, (list, tuple, set)) else [source])
    return found


@dataclass
class StateMeasurement:
    alpha: float
    top_tokens: List[str]
    top_probs: List[float]
    continuation: str
    #: True when generation stopped at the token limit rather than at an end-of-sequence token,
    #: so the text is cut off mid-thought. The page marks these rather than tidying them away.
    truncated: bool = False


@torch.no_grad()
def measure_states(
    tokenizer,
    model,
    prompt: str,
    prefix: str,
    vector: torch.Tensor,
    layer: int,
    scale: float = 1.0,
    alphas: Sequence[float] = tuple(ALPHAS),
    top_k: int = 12,
    max_new_tokens: int = 24,
    generate: bool = True,
) -> List[StateMeasurement]:
    """
    Runs the model once per alpha and records what actually comes out.

    Set `generate=False` during a layer sweep: the next-token distribution alone is enough to
    score a layer, and skipping generation makes the sweep many times faster.
    """
    base = build_context(tokenizer, prompt, prefix)
    ids = torch.tensor([base], device=model.device)
    attention_mask = torch.ones_like(ids)
    stop_ids = _stop_token_ids(tokenizer, model)
    hook = SteeringHook((vector * scale).to(model.dtype))
    handle = decoder_layers(model)[layer - 1].register_forward_hook(hook)

    results: List[StateMeasurement] = []
    try:
        for alpha in alphas:
            hook.alpha = float(alpha)

            logits = model(ids, attention_mask=attention_mask).logits[0, -1].float()
            probs = torch.softmax(logits, dim=-1)
            values, indices = torch.topk(probs, top_k)
            tokens = [tokenizer.decode([i]) for i in indices.tolist()]

            continuation = ""
            truncated = False
            if generate:
                # The model's packaged generation_config may carry sampling defaults and a
                # repetition penalty. Both are overridden here so the first generated token is
                # exactly the argmax of the distribution shown alongside it - otherwise the
                # chart and the sentence below it would disagree.
                generated = model.generate(
                    ids,
                    attention_mask=attention_mask,
                    max_new_tokens=max_new_tokens,
                    do_sample=False,
                    num_beams=1,
                    temperature=None,
                    top_p=None,
                    top_k=None,
                    repetition_penalty=1.0,
                    pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
                )
                produced = generated[0, len(base) :]
                # generate() stops at ANY of the configured stop tokens or at the limit. Qwen
                # lists two, so checking only tokenizer.eos_token_id marks finished generations
                # as cut off.
                truncated = not (set(produced.tolist()) & stop_ids)
                continuation = tokenizer.decode(produced, skip_special_tokens=True)

            results.append(
                StateMeasurement(
                    alpha=float(alpha),
                    top_tokens=tokens,
                    top_probs=[float(v) for v in values.tolist()],
                    continuation=continuation,
                    truncated=truncated,
                )
            )
    finally:
        handle.remove()
    return results


def probability_of(state: StateMeasurement, token: str) -> float:
    """Probability the measurement assigned to `token`, or 0 if it fell outside the top-k."""
    for candidate, value in zip(state.top_tokens, state.top_probs):
        if candidate == token:
            return value
    return 0.0


def separation_score(states: Sequence[StateMeasurement]) -> Dict[str, float]:
    """
    How legibly this (layer, scale) demonstrates steering.

    The winning token at each end must differ, the swing between the ends should be large, and
    the number of distinct winners across the nine states should be small enough to show as a
    handful of chart rows.
    """
    negative_token = states[0].top_tokens[0]
    positive_token = states[-1].top_tokens[0]
    winners = []
    for state in states:
        if state.top_tokens[0] not in winners:
            winners.append(state.top_tokens[0])

    if negative_token == positive_token:
        return {"score": 0.0, "swing": 0.0, "distinct": float(len(winners))}

    swing = (
        probability_of(states[0], negative_token)
        - probability_of(states[-1], negative_token)
        + probability_of(states[-1], positive_token)
        - probability_of(states[0], positive_token)
    )

    # Three distinct winners is the designed shape; more still works but reads as a busier chart.
    shape_penalty = {1: 0.0, 2: 0.85, 3: 1.0, 4: 0.9, 5: 0.7}.get(len(winners), 0.5)

    # The neutral state should sit between the extremes rather than already being at one end.
    middle = states[len(states) // 2].top_tokens[0]
    balance = 1.0 if middle not in (negative_token, positive_token) else 0.8

    return {
        "score": max(0.0, swing) * shape_penalty * balance,
        "swing": swing,
        "distinct": float(len(winners)),
    }


# --- turning measurements into the shape the page consumes -------------------------------

MAX_CANDIDATES = 6


def clean_continuation(text: str, truncated: bool = False) -> str:
    """
    Prepares a raw generation for a single display line.

    Whitespace is collapsed and nothing else is touched: the page shows the model's own words,
    including the repetitive and the unfinished ones. An earlier version cut to the first
    sentence, which quietly mistook a numbered-list marker ("Here are some examples: 1.") for the
    end of a sentence and hid the rest of the output.

    A trailing ellipsis is appended only when generation stopped at the token limit, so the mark
    means exactly one thing: the model was still going when it was cut off.
    """
    text = " ".join(text.split()).strip()
    if text and truncated:
        return f"{text}\u2026"
    return text


def select_candidates(states: Sequence[StateMeasurement]) -> List[str]:
    """
    The candidate rows are the tokens that actually win somewhere on the slider, in the order
    they first win as alpha rises. Choosing them this way guarantees the selected token is the
    true argmax at every state, so the shown continuation always starts with a shown candidate.
    """
    winners: List[str] = []
    for state in states:
        token = state.top_tokens[0]
        if token not in winners:
            winners.append(token)

    if len(winners) > MAX_CANDIDATES:
        raise ValueError(
            f"{len(winners)} different tokens win across the nine states ({winners}); "
            f"the page supports at most {MAX_CANDIDATES}. Retune the layer or the coefficient."
        )

    # Pad to three rows with the next most probable tokens, so a very stable scenario still
    # shows the alternatives it is choosing between.
    if len(winners) < 3:
        ranked: Dict[str, float] = {}
        for state in states:
            for token, prob in zip(state.top_tokens, state.top_probs):
                ranked[token] = max(ranked.get(token, 0.0), prob)
        for token, _ in sorted(ranked.items(), key=lambda kv: -kv[1]):
            if token not in winners:
                winners.append(token)
            if len(winners) == 3:
                break
    return winners


def to_payload(
    spec,
    states: Sequence[StateMeasurement],
    layer: int,
    scale: float,
) -> dict:
    """Measurements -> the JSON the UI and the Markdown writer both consume."""
    candidates = select_candidates(states)
    rows = []
    for state in states:
        # Two decimals, so a token that is genuinely absent from the top-k reads as 0 while a
        # small but real probability survives rounding and can be shown as "<0.1%".
        percents = [round(probability_of(state, token) * 100, 2) for token in candidates]
        other = round(100.0 - sum(percents), 2)
        if other < 0:
            other = 0.0
        selected = state.top_tokens[0]
        rows.append(
            {
                "alpha": state.alpha,
                "percents": percents,
                "other": other,
                "selected": selected,
                "continuation": clean_continuation(state.continuation, state.truncated),
                "truncated": state.truncated,
            }
        )

    return {
        "id": spec.id,
        "title": spec.title,
        "negative_label": spec.negative_label,
        "positive_label": spec.positive_label,
        "prompt": spec.prompt,
        "prefix": spec.prefix,
        "takeaway": spec.takeaway,
        "candidates": candidates,
        "layer": layer,
        "scale": scale,
        "states": rows,
    }


def candidate_id(token: str, taken: Sequence[str]) -> str:
    """A stable, readable Markdown id for a token, e.g. ' captivating' -> 'captivating'."""
    base = "".join(ch if ch.isalnum() else "-" for ch in token.strip().lower()).strip("-")
    base = "-".join(part for part in base.split("-") if part) or "token"
    if base[0].isdigit():
        base = f"t-{base}"
    candidate = base
    suffix = 2
    while candidate in taken:
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate
