# Where the numbers come from

Everything the page shows as a probability or a sentence is measured from a real model. This
document describes exactly what is measured, what is chosen by hand, what has been checked, and
what has not.

## Provenance record

`docs/measurement-report.json` is written by the same run that writes `content/scenarios.md` and
records the environment from the process itself rather than from prose here. The values below are
from the run that produced the shipped data.

| | |
| --- | --- |
| Model | `Qwen/Qwen2.5-0.5B-Instruct`, revision `7ae557604adf67be50417f59c2c2f167def9a775` |
| Alternate | `HuggingFaceTB/SmolLM2-135M-Instruct`, revision `12fd25f77366fa6b3b4b768ec3050bf629380bac` |
| Runtime | Python 3.9.6, torch 2.8.0, transformers 4.57.6, macOS arm64 |
| Device / dtype | CPU, `torch.float32`, eager attention |
| Serialisation | the tokenizer's chat template with `add_generation_prompt=True`, then the prefix appended as raw text, tokenised with `add_special_tokens=False` |
| Direction | mean activation over the *continuation* tokens of six positive examples minus the same over six negative examples, **not** normalised |
| Hook | forward hook on `decoder_layers[layer - 1]`, whose output is `hidden_states[layer]` — the residual stream after that block |
| Scope | added at **every position** of whatever the forward pass sees: all prompt and prefix positions during prefill, then each newly generated position during cached decoding |
| Equation | `h' = h + alpha * c * v`, where `c` is the per-scenario coefficient shown in the badge. `alpha` is the slider; at `c = 2` and `alpha = 1` the intervention is scaled by 2 |
| Decoding | greedy; `do_sample=False`, `num_beams=1`, `temperature/top_p/top_k` unset, `repetition_penalty=1.0`, `max_new_tokens=40` |
| Stop | any id in the tokenizer's or the generation config's `eos_token_id`; otherwise the token limit, recorded as `limit` in the `Stopped` column |
| Probabilities | softmax in float64 over the full vocabulary. Each displayed candidate's value is read from that full row **by token id**, at every state, and stored at six significant figures |
| "Other" | `1 - sum(candidate probabilities)`, computed before any rounding |

`torch.manual_seed(0)` is set at the top of the run. Greedy decoding draws no random numbers, so
the seed does not affect these results; it is set so that adding any sampled comparison later
starts from a fixed state.

### Why probabilities are stored this way

The candidate rows are chosen *after* all nine states are measured — they are the tokens that win
somewhere on the slider. A token that wins at one end can be vanishingly unlikely at the other, so
it will not appear in any fixed-size top-k list at those states.

An earlier version looked candidates up in a retained top-k by decoded string and returned `0`
when it missed, then rounded every percentage to two decimals before storing it. Both steps
destroyed real values: six numbers in the shipped data were stored as exact zero when the smallest
of them was actually `0.000173507%`. Rendering `<0.1%` cannot recover a value that was already
gone. Probabilities are now read from the complete softmax row by token id and stored with enough
precision to survive, and exact zero stays distinguishable from a very small positive number.

## What has been verified

Measured, not asserted. Re-running `scripts/measure_steering.py` reproduces these.

| Claim | How it was checked | Result |
| --- | --- | --- |
| `alpha = 0` is the unmodified model | Same context run twice under identical decoding: once with no hook registered, once with the hook installed at `alpha = 0`. Compared next-token logits and the greedy continuation | `max abs logit difference = 0.000e+00`, argmax token id identical, first 8 greedy token ids identical, for all three scenarios |
| The run is deterministic | The full measurement run executed twice on the same machine | Byte-identical tables |
| The shown token is the model's argmax | The content validator rejects any state whose `Selected` is not the maximum candidate, and the payload carries the argmax by index | Enforced at build time, on every build |
| The continuation starts with the shown token | Validator check, plus `tests/python/test_steering_core.py` | Enforced at build time |
| CPU and GPU agree closely enough for the page | All 27 states re-run on the Space's GPU and compared against the recorded CPU values, by `scripts/compare_devices.py` | Worst relative difference `8.19e-05`; **0** argmax disagreements; all 27 continuations byte-identical |

The `alpha = 0` comparison is run for each scenario on every measurement run and stored in
`docs/measurement-report.json` under `identity_at_zero`.

### CPU against GPU

Shared source is not evidence of identical output, so this was measured rather than assumed:

```bash
python scripts/compare_devices.py --token hf_...
```

All 27 states were re-run on the Space (ZeroGPU A10G, `cuda:0`, float32) and compared against the
recorded CPU values. Probabilities agree to within a relative difference of `8.19e-05`, every
state selects the same token, and every one of the 27 generated continuations is byte-identical.

They are **not** bit-identical, and the page does not claim they are: the smallest shipped value
reads `0.000173507%` on CPU and `0.000173499%` on GPU. A difference large enough to matter would
show up as an argmax disagreement, because that is what would change the token on screen; none
occurred. This says nothing about other GPUs, other models, or other driver versions, and a live
result is still labelled as computed by the Space rather than presented as the recorded one.

### What is not established

- The device comparison above is a single run against one GPU type. It is not a claim that any GPU
  reproduces the recorded numbers, and a near-tie between two candidates could still resolve
  differently on hardware not tested here.
- No independent replication of the layer/coefficient sweep; those are **selected demonstration
  settings**, chosen because the intended contrast showed clearly, not evidence that steering
  works this well in general.
- No claim that the displayed candidates are the three most likely tokens at a given alpha. They
  are the tokens that win *somewhere* on the slider.
- A token's probability is not the probability of the whole displayed response, nor of a semantic
  category such as "positive sentiment".
- The direction is a difference of means over twelve short examples per scenario. Nothing
  establishes that it isolates the named concept rather than something correlated with it in those
  examples.
- Nothing here generalises to larger models.

## The intervention

A causal language model builds an internal representation at each position. The pipeline picks a
direction in that space and adds a signed multiple of it to the residual stream at one decoder
layer, at every position, while the model runs:

```
h' = h + alpha * c * v
```

`alpha` is the slider, `c` is the fixed per-scenario coefficient shown in the badge, and `v` is a
**difference of means**. For each scenario the model is shown a handful of continuations that sit
at each end of that scenario's axis — six calm ones and six dramatic ones, for example — each in
the scenario's own prompt and prefix, so the direction is estimated where the model actually is
when it answers. `v` is then the mean activation over the positive examples minus the mean over
the negative ones. This is the standard contrastive-activation construction; it is not novel, and
it is not a claim about a learned or optimised direction.

The implementation is `scripts/steering_core.py`, shared by the offline pipeline and the live
Space.

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

## Why the prefix is fixed

The prompt and the opening words of the answer never change as the slider moves. That is what
makes the chart readable: every state is measured at **the same position in the same context**, so
the nine distributions differ only by the intervention, and the comparison between them is a
comparison of one thing.

Where that position falls is a presentational choice, and it matters. "The movie was" is a poor
place to look — the model's most likely next token there is "a", and the sentiment word arrives
several tokens later, where a single-position chart cannot show it. The three shipped prefixes end
where the next word is likely to carry the scenario's meaning:

| Scenario | Prefix | Next word carries |
| --- | --- | --- |
| Movie Critic | "The movie was absolutely" | the sentiment |
| Animal Enthusiast | "I'd spend the afternoon with a" | the animal |
| Storyteller | "The door opened rather" | the manner |

Two of the three end on an intensifier and one ends on an article; what they have in common is the
next position, not the part of speech.

## Why "Other" is often the largest row

The model is choosing among tens of thousands of tokens. Three candidates capture a real but
partial share of the distribution, and the rest is aggregated into "Other". A large Other row is
not a bug; it is what a next-token distribution actually looks like. The validator emits a warning
rather than an error when Other exceeds the largest candidate, because for measured content that
is expected.

## Choosing the layer and the coefficient

These are design decisions, disclosed on the page. `--sweep` scores each combination on whether
the intended contrast appears at the ends of the slider without the model losing fluency:

```bash
python scripts/measure_steering.py --sweep
```

Put the chosen values into `scripts/steering_scenarios.py` and re-run without `--sweep`.

The probabilities that follow from a chosen setting are measurements; the choice of setting is
not. Both facts are stated in the page's "How this works" section.

## Model choice

Tried, with the scenarios as written:

| Model | Result |
| --- | --- |
| `Qwen/Qwen2.5-0.5B-Instruct` | **chosen** — separates clearly and lands on natural tokens in all three scenarios |
| `HuggingFaceTB/SmolLM2-135M-Instruct` | works, but spreads probability so thinly that Other reaches 80% |
| `HuggingFaceTB/SmolLM2-360M-Instruct` | unusable storyteller direction (won on the token `" than"`) |
| `google/gemma-3-270m-it` | not tried — gated, needs a licence acceptance and a token |

To use Gemma, accept the licence at its model page, run `huggingface-cli login`, then
`python scripts/measure_steering.py --model google/gemma-3-270m-it --sweep`.

## Adding a scenario

The three that ship share a shape, and it is the shape that makes them work:

1. **A concrete axis** the model already has words for &mdash; sentiment, cat versus dog, calm
   versus dramatic. Abstract axes ("modest versus confident") do not separate cleanly at 0.5B.
2. **A prefix that ends one word short of the meaning**, so the charted position is the one
   carrying the scenario's axis rather than an article or a filler word.
3. **Strong collocations at both poles**: "absolutely terrible" and "absolutely captivating" are
   both things the model expects to say.
4. **Six contrast continuations per pole**, written as natural completions of that exact prefix.

Then sweep and look at the winners:

```bash
python scripts/measure_steering.py --sweep
```

Keep it only if three distinct, real words win across the slider and the top-1 probabilities are
healthy. For reference, five designs were tried and rejected for this page:

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
`npm run content:check` validates the result and `npm run build` ships it.

The pipeline's own arithmetic has unit tests, which need the same virtualenv because they import
`steering_core`:

```bash
.venv/bin/python -m unittest discover -s tests/python -v
```

Those tests use synthetic distributions. They check the path from a softmax row to the numbers on
the page; they are not evidence about any model's behaviour.

## Honesty checklist

The page must never claim more than it measured. Specifically it says:

- the numbers are one position only, not the whole sentence;
- "Other" is aggregated mass, not a token;
- the layer and coefficient were chosen, not derived;
- the response is not smooth, monotonic or symmetric, and you can see that on the slider;
- negative and positive are directions, not verdicts;
- a result replayed from the Space's cache is labelled as replayed, not as computed just now;
- this is a small model, and nothing here is a result about larger systems.
