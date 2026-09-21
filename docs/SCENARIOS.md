# The scenario file format

> **`content/scenarios.md` is generated.** It is rewritten by
> `python scripts/measure_steering.py`, which measures a real model. To change a scenario, edit
> [`scripts/steering_scenarios.py`](../scripts/steering_scenarios.py) and re-measure &mdash; see
> [MEASUREMENT.md](MEASUREMENT.md). This document describes the *format* that file must satisfy,
> which is also a perfectly good format to hand-author if you ever want to.

Everything the showcase displays comes from [`content/scenarios.md`](../content/scenarios.md).
There is no JSON to edit, no database and no bot. At build time
`scripts/build-scenarios.ts` parses that file, validates it, and writes
`src/data/scenarios.generated.json`, which the UI imports. The generated file is git-ignored;
it is recreated by `npm run content:build` and by every build.

If the Markdown is invalid the build stops with the file, line, scenario and field named, so a
bad edit can never reach a deployment.

```bash
npm run content:check   # validate without writing anything
npm run content:build   # validate and regenerate the JSON
npm run dev             # the dev server regenerates on save
```

## File shape

Anything before the first `##` heading is prose and is ignored, so the top of the file can hold
notes. Each scenario is then one `##` section containing six fields and two tables:

```markdown
## movie-critic

Title: Movie Critic
Negative label: Negative sentiment
Positive label: Positive sentiment
Prompt: Give a one-sentence review of the fictional movie Midnight on Mars.
Prefix: The movie was
Takeaway: Steering can change sentiment while the prompt and subject stay fixed.

| ID | Token |
| --- | --- |
| negative | ` terrible` |
| neutral | ` decent` |
| positive | ` brilliant` |

| Alpha | negative | neutral | positive | Other | Selected | Stopped | Continuation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| -2 | 70 | 15 | 3 | 12 | negative | end | terrible—a tedious adventure with flat characters and a predictable ending. |
| ... seven more rows ...
| 2 | 3 | 15 | 70 | 12 | positive | end | brilliant—a thrilling adventure with unforgettable characters and a stunning ending. |
```

The heading text is the scenario **ID**: lowercase letters, digits and single hyphens. IDs must
be unique. Tabs appear in file order, and the first scenario is the one that loads by default.

## Provenance

Lines above the first `##` heading are prose and ignored, except for a few optional keys that
record where the numbers came from. `Model`, `Method` and `Measured` must all be present for the
provenance to be read at all; the page then names the model beside the results. `Method` is stored
but never rendered. Leave any of the three out and the page falls back to naming the model
`unknown` &mdash; there is no "illustrative data" disclaimer, so do not rely on omission to mark a
file as unmeasured. `Revision` is optional; when present the page names it alongside the model,
because a model id without a revision only half identifies the weights.

```markdown
Model: Qwen/Qwen2.5-0.5B-Instruct
Revision: 7ae557604adf67be50417f59c2c2f167def9a775
Method: difference of means over contrastive continuations; h' = h + alpha * c * v ...
Measured: 2026-09-20
```

## Fields

| Field | Used for |
| --- | --- |
| `Title` | the tab label and headings |
| `Negative label` | what &alpha; = &minus;2 means, shown at the left end of the slider |
| `Positive label` | what &alpha; = +2 means, shown at the right end of the slider |
| `Prompt` | the fixed user prompt |
| `Prefix` | the fixed response prefix the continuation follows |
| `Takeaway` | the one-sentence conclusion under the panels |
| `Layer` | *optional* &mdash; decoder layer the steering vector was added at |
| `Coefficient` | *optional* &mdash; multiplier applied to the steering vector |

The first six are required and all are rendered as plain text. Field names are case-insensitive.
Markdown inside a value is **not** interpreted and HTML is **not** executed &mdash; author
strings always render as text.

## Candidate table

Declares the candidate tokens, in the order the chart rows appear.

```markdown
| ID | Token |
| --- | --- |
| negative | ` terrible` |
```

- The header must be exactly `| ID | Token |`.
- `ID` follows the same rules as a scenario id, and must be unique within the scenario.
- The token sits in a **single-backtick code span**, and every character between the backticks is
  kept verbatim &mdash; including the leading space in `` ` terrible` ``. Tokens are word-level
  candidates and normally start with a space; a token without one is accepted with a warning.
- Two to six candidates are supported. **Three is the designed shape**: the colour scheme treats
  the first candidate as the negative pole, the last as the positive pole, and anything between
  as neutral.

## Steering-state table

One row per slider position. Exactly nine rows are required, one for each of
`-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2`.

Columns are matched by name, so their order does not matter, but the set must be exactly:
`Alpha`, one column per candidate ID, `Other`, `Selected`, `Stopped`, `Continuation`.

- **Percentages** are numbers with no `%` sign, each between 0 and 100. Every row must total 100
  within a tolerance of 0.5. Exponent notation (`1.73507e-4`) is accepted and is what the
  measurement pipeline writes for very small values: a token that wins at one end of the slider
  can be genuinely tiny at the other, and writing it as `0` would claim the model gave it no
  weight at all. A value of exactly `0` means exactly zero.
- **`Other`** is the remaining probability mass added together. It is not a token, it never wins
  the argmax, and the UI labels it separately. The validator warns, but does not fail, when it
  exceeds the largest candidate: for measured content that is normal, because a real model spreads
  probability across a large vocabulary.
- **`Selected`** names the candidate with the highest probability in that row. Two candidates may
  share the top value &mdash; stored percentages are rounded to six significant figures, which can
  tie tokens the underlying measurement separated &mdash; in which case whichever is declared
  `Selected` wins.
- **`Continuation`** is the generated text after the prefix. It must begin with the selected
  candidate's token, ignoring the token's leading space and its case. The UI renders it as
  `Prefix` + space + `Continuation`, highlighting that first token.

Reusing the same continuation across neighbouring states is fine.

## Escaping and limits

- A **literal pipe** inside a cell is written `\|`. A literal backslash is `\\`.
- A **cell must stay on one line.** A wrapped cell produces the wrong number of cells and fails
  with `Row has N cells, expected M`.
- Every table needs its `| --- | --- |` separator row directly under the header.
- A single-line HTML comment (`<!-- note -->`) inside a section is ignored, which is a handy
  place for author notes. Any other unrecognised line is an error, so a typo is never silently
  dropped.

## What the validator checks

Errors (the build fails, and each message names the file, line, scenario and field):

- duplicate or malformed scenario IDs; a file with no scenarios at all
- missing, empty, duplicated or unknown fields
- a candidate table with the wrong header, a malformed or duplicated ID, a token that is not a
  code span, an empty or duplicated token, or fewer than two / more than six candidates
- a state table with a missing, duplicated or unexpected column
- a row whose cell count does not match the header
- an alpha value that is not a number, is off the nine-state grid, or is duplicated
- a missing steering state
- a percentage that is non-numeric, non-finite, or outside 0&ndash;100
- a row whose percentages do not total 100 within 0.5
- a `Selected` value that is not a declared candidate
- a `Selected` value that is not among the highest candidates in that row
- an empty continuation, or one that does not begin with the selected token

Warnings (reported, build continues; `--strict` turns them into failures):

- a token with no leading space
- an `Other` share larger than the biggest candidate in that row

## Editing an existing scenario

Change the text or the numbers and save. Keep each row's total at 100, and if you change which
candidate is largest, update both `Selected` and the first word of `Continuation` to match &mdash;
the validator will tell you if you forget.

## Adding a scenario

Copy the block below to the end of `content/scenarios.md`, change the ID and the text, and run
`npm run content:check`. A new tab appears automatically; no component, route or configuration
changes are needed.

```markdown
## my-scenario

Title: My Scenario
Negative label: Something
Positive label: Something else
Prompt: The fixed question the user asked.
Prefix: The answer began
Takeaway: One sentence about what this scenario shows.

| ID | Token |
| --- | --- |
| low | ` quietly` |
| mid | ` plainly` |
| high | ` loudly` |

| Alpha | low | mid | high | Other | Selected | Stopped | Continuation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| -2 | 70 | 15 | 5 | 10 | low | end | quietly, and nothing else happened. |
| -1.5 | 60 | 22 | 8 | 10 | low | end | quietly, and nothing else happened. |
| -1 | 50 | 30 | 10 | 10 | low | end | quietly, with only a small pause after. |
| -0.5 | 35 | 40 | 15 | 10 | mid | end | plainly, without much either way. |
| 0 | 20 | 55 | 15 | 10 | mid | end | plainly, without much either way. |
| 0.5 | 15 | 40 | 35 | 10 | mid | end | plainly, though a little more firmly. |
| 1 | 10 | 30 | 50 | 10 | high | end | loudly, and everyone turned to look. |
| 1.5 | 8 | 22 | 60 | 10 | high | end | loudly, and everyone turned to look. |
| 2 | 5 | 15 | 70 | 10 | high | end | loudly, drowning out everything else. |
```

## Choosing the seven intermediate rows

The three anchor rows (&minus;2, 0, +2) are the ones worth designing by hand. A practical way to
fill in the rest:

1. Interpolate each candidate linearly between the anchors &mdash; a quarter, a half and three
   quarters of the way from &minus;2 to 0, and the same again from 0 to +2.
2. Round to whole numbers, giving the leftover point to the value with the largest fraction so
   the row still totals 100. Mirroring the two halves keeps the table easy to read.
3. **Write the results into the Markdown.** Nothing is interpolated at runtime, and the numbers
   are not a measurement of anything &mdash; they are authored illustrations, and the page says so.
4. Write a natural continuation for each row, starting with whichever candidate came out largest.
