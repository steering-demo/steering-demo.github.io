# Where the numbers come from

Everything the page shows as a probability or a sentence is measured from a real model. This
document describes exactly what is measured, what is chosen by hand, and how to reproduce or
change it.

## Provenance record

Everything needed to reproduce or challenge a number on the page.

| | |
| --- | --- |
| Model | `Qwen/Qwen2.5-0.5B-Instruct`, revision `7ae557604adf67be50417f59c2c2f167def9a775` |
| Alternate | `HuggingFaceTB/SmolLM2-135M-Instruct`, revision `12fd25f77366fa6b3b4b768ec3050bf629380bac` |
| Precision / device | float32, CPU, eager attention, `torch.manual_seed(0)` |
| Serialisation | the tokenizer's chat template with `add_generation_prompt=True`, then the prefix appended as raw text, tokenised with `add_special_tokens=False` |
| Direction | mean activation over the *continuation* tokens of six positive examples minus the same over six negative examples, **not** normalised |
| Hook | forward hook on `decoder_layers[layer - 1]`, whose output is `hidden_states[layer]` — the residual stream after that block |
| Scope | added at **every position** of whatever the forward pass sees: all prompt and prefix positions during prefill, then each newly generated position during cached decoding |
| Equation | `h' = h + alpha * c * v`, where `c` is the per-scenario coefficient shown in the badge. At `c = 2` and `alpha = 1`, the vector is added twice over |
| Decoding | greedy; `do_sample=False`, `num_beams=1`, `temperature/top_p/top_k` unset, `repetition_penalty=1.0`, `max_new_tokens=40` |
| Stop | any id in the tokenizer's or the generation config's `eos_token_id`; otherwise the token limit, which is recorded as `limit` in the `Stopped` column |
| Probabilities | softmax over the full vocabulary, top-512 retained; stored to two decimals so a small non-zero value is not displayed as `0%` |
| Identity | `alpha = 0` makes the hook the identity function, so that row is the unmodified model under the same decoding configuration |

The same `steering_core.py` runs offline and in the Space, so the two produce identical numbers
from identical inputs.

### What is not established

- No independent replication of the layer/coefficient sweep; those are **selected demonstration
  settings**, chosen because the intended contrast showed clearly, not evidence that steering
  works this well in general.
- No claim that the displayed candidates are the three most likely tokens at a given alpha. They
  are the tokens that win *somewhere* on the slider.
- A token's probability is not the probability of the whole displayed response, nor of a semantic
  category such as "positive sentiment".
- Nothing here generalises to larger models.

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

## Adding a scenario

The three that ship share a shape, and it is the shape that makes them work:

1. **A concrete axis** the model already has words for &mdash; sentiment, cat versus dog, calm
   versus dramatic. Abstract axes ("modest versus confident") do not separate cleanly at 0.5B.
2. **A prefix ending on an intensifier**, so the charted position is forced to be the meaningful
   word: "was absolutely", "opened rather".
3. **Strong collocations at both poles**: "absolutely terrible" and "absolutely captivating" are
   both things the model expects to say.
4. **Six contrast continuations per pole**, written as natural completions of that exact prefix.

Then sweep and look at the winners:

```bash
python scripts/measure_steering.py --sweep
```

Keep it only if three distinct, real words win across the slider and the top-1 probabilities are
healthy. For reference, four designs were tried and rejected for this page:

| Attempt | Axis | Why it was dropped |
| --- | --- | --- |
| Forecaster | Hedged / Certain | winners were `" impossible"`, `" highly"`, `" scheduled"` — no clean axis |
| Job applicant | Modest / Confident | `" good"` / `" strong"` / `" unique"` — the positive pole never read as confidence |
| Weather reporter | Freezing / Sweltering | only one configuration produced three word winners, and it was `" snow"` / `" clear"` / `" perfect"` |
| Traveller | Restful / Adventurous | best was `" boring"` / `" delightful"` / `" epic"` at top-1 0.06, too fragile to ship |
| Food critic | Bland / Fiery | the closest miss: `" bland"` at 0.69 and `" delicious"` at 0.63 are excellent, but the hot pole never produced a whole word — it landed on the fragment `" over"` (as in *overwhelming*). Changing the prefix to "was seriously" made the neutral pole worse. |

A weak scenario undercuts the page more than a missing one adds to it. The prompt box is the
better answer to "more examples": it lets a visitor try any of these themselves, and see for
themselves when a direction fails to transfer.

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
