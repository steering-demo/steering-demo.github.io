# Where the numbers come from

Everything the page shows as a probability or a sentence is measured from a real model. This
document describes exactly what is measured, what is chosen by hand, and how to reproduce or
change it.

## The intervention

A causal language model builds an internal representation at each position. The pipeline picks a
direction in that space and adds a signed multiple of it to the residual stream at one decoder
layer, at every position, while the model runs:

```
h' = h + alpha * coefficient * v
```

`v` is a **difference of means**. For each scenario the model is shown a handful of continuations
that sit at each end of that scenario's axis — six calm ones and six dramatic ones, for example —
each in the scenario's own prompt and prefix, so the direction is estimated where the model
actually is when it answers. `v` is then the mean activation over the positive examples minus the
mean over the negative ones. This is the standard contrastive-activation construction; it is not
novel, and it is not a claim about a learned or optimised direction.

The implementation is `scripts/steering_core.py`, about 200 lines, shared verbatim by the offline
pipeline and the live Space.

## What is measured and what is authored

| Authored by hand | Measured from the model |
| --- | --- |
| scenario titles and direction labels | the candidate tokens |
| the prompt | the next-token probabilities |
| the response prefix | the aggregated "Other" share |
| the contrast examples that define `v` | every continuation |
| the layer and coefficient (chosen by sweeping) | |
| the takeaway sentence | |

The **candidate rows are chosen by the data**: they are the tokens that actually win somewhere on
the slider, in the order they first win as alpha rises. Choosing them this way guarantees that the
token shown as selected really is the model's argmax at that state, so the chart and the sentence
below it can never disagree.

Generation is pure greedy decoding with sampling, temperature and any packaged repetition penalty
explicitly disabled, because the first generated token has to be exactly the argmax of the
distribution shown beside it. (A model whose `generation_config.json` carries
`repetition_penalty` will otherwise quietly produce a different first word; the validator catches
this, and did.)

## Choosing the layer and the coefficient

These are design decisions, disclosed on the page. `--sweep` scores each combination on whether
the intended contrast appears at the ends of the slider without the model losing fluency:

```bash
python scripts/measure_steering.py --sweep
```

Put the chosen values into `scripts/steering_scenarios.py` and re-run without `--sweep`.

The probabilities that follow from a chosen setting are measurements; the choice of setting is
not. Both facts are stated in the page's "How this works" section.

## Why each prefix ends on an intensifier

"The movie was" is a poor place to look: the model's most likely next token is "a", and the
sentiment word arrives a few tokens later, where a single-position chart cannot show it. Ending
the prefix on an intensifier — "was absolutely", "opened rather" — puts the semantically loaded
word at exactly the position being charted. This is a presentational choice and the page says so.

## Why "Other" is often the largest row

The model is choosing among tens of thousands of tokens. Three candidates capture a real but
partial share of the distribution, and the rest is aggregated into "Other". A large Other row is
not a bug; it is what a next-token distribution actually looks like. The validator emits a warning
rather than an error when Other exceeds the largest candidate, because for measured content that
is expected.

## Model choice

Tried, with the scenarios as written:

| Model | Result |
| --- | --- |
| `Qwen/Qwen2.5-0.5B-Instruct` | **chosen** — sharpest separation, lands on natural tokens in all three scenarios |
| `HuggingFaceTB/SmolLM2-135M-Instruct` | works, but spreads probability so thinly that Other reaches 80% |
| `HuggingFaceTB/SmolLM2-360M-Instruct` | unusable storyteller direction (won on the token `" than"`) |
| `google/gemma-3-270m-it` | not tried — gated, needs a licence acceptance and a token |

To use Gemma, accept the licence at its model page, run `huggingface-cli login`, then
`python scripts/measure_steering.py --model google/gemma-3-270m-it --sweep`.

## Reproducing

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r scripts/requirements.txt
python scripts/measure_steering.py
```

This rewrites `content/scenarios.md` and `docs/measurement-report.json`. Then
`npm run content:check` validates the result, and `npm run build` ships it.

Runs are deterministic: greedy decoding, fixed seed, float32 on CPU. The same model and the same
settings produce the same file.

## Honesty checklist

The page must never claim more than it measured. Specifically it says:

- the numbers are one position only, not the whole sentence;
- "Other" is aggregated mass, not a token;
- the layer and coefficient were chosen, not derived;
- the response is not smooth, monotonic or symmetric, and you can see that on the slider;
- negative and positive are directions, not verdicts;
- this is a small model, and nothing here is a result about larger systems.
