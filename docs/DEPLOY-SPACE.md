# Deploying the live Space

> **Already deployed:** <https://huggingface.co/spaces/wang2226/steering-showcase>, running on
> ZeroGPU and serving `Qwen/Qwen2.5-0.5B-Instruct`. Its URL is the committed default in `.env`,
> so `npm run build` picks it up with no extra configuration. The steps below are what was done,
> and what to repeat for a second Space or a different account.

The site works without this. Skip it and the page ships the recorded measurements, which are real
numbers from a real model. Do this when you want the page to recompute scenarios during a visit.

## What you need

- A Hugging Face account with a **verified email**, **older than 30 days**. Those are the
  conditions for hosting a free ZeroGPU Space, and you may host **two**.
- Nothing installed locally beyond `git`. No `git-lfs` (nothing large is committed — the model is
  downloaded from the Hub at runtime) and no CLI tools.

## 1. Create the Space

Go to <https://huggingface.co/new-space> and set:

| Field | Value |
| --- | --- |
| Owner | your username |
| Space name | `steering-showcase` (anything; it becomes part of the URL) |
| License | your choice, e.g. `mit` |
| SDK | **Gradio** |
| Hardware | **ZeroGPU** |
| Visibility | **Public** |

**Public matters.** A private Space returns 404 to the browser, and the page calls it directly
from the visitor's browser with no token. If ZeroGPU is not offered on the create form, create the
Space first and then set it under **Settings → Hardware**.

Your Space URL follows from the names, lowercased with non-alphanumerics turned into hyphens:

```
huggingface.co/spaces/haoranwang18/steering-showcase
  ->  https://haoranwang18-steering-showcase.hf.space
```

That second URL is the one the site calls.

## 2. Get a write token

<https://huggingface.co/settings/tokens> → **Create new token** → give it **write** access. Copy
it; you use it as the password when pushing.

## 3. Sync the shared modules

`space/` needs current copies of the two measurement modules so the Space computes exactly what
the offline pipeline does:

```bash
cd /Users/Bruce/Documents/work/steering-demo.github.io
./scripts/build-space.sh
```

## 4. Push the files

```bash
git clone https://huggingface.co/spaces/<you>/steering-showcase /tmp/hf-space
cp space/app.py space/requirements.txt space/README.md \
   space/steering_core.py space/steering_scenarios.py /tmp/hf-space/
cd /tmp/hf-space
git add -A
git commit -m "Deploy steering showcase API"
git push
```

Git will ask for credentials: **username** is your Hugging Face username, **password** is the
token from step 2.

`space/README.md` replaces the one Hugging Face generated. That is intentional — it carries the
front matter (`sdk: gradio`, `app_file: app.py`) the Space needs.

> Prefer not to use git? On the Space page open **Files → Add file → Upload files** and drag the
> same five files in. Same result.

## 5. Wait for the first build

The Space page shows **Building**, then **Running**. The first build installs dependencies, and
the first request downloads the model (~1 GB), so allow a few minutes. **Logs** shows progress and
any error.

## 6. Check the API directly

```bash
SPACE=https://<you>-steering-showcase.hf.space
EVENT=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"data":["movie-critic"]}' "$SPACE/gradio_api/call/run_scenario" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["event_id"])')
curl -s -N "$SPACE/gradio_api/call/run_scenario/$EVENT" | tail -2
```

You should get one long `data:` line containing the nine steering states. If the path 404s, the
Space is on Gradio 4 — try `/call/run_scenario` instead. The site tries both automatically.

## 7. Point the site at it

Locally:

```bash
PUBLIC_STEERING_SPACE=https://<you>-steering-showcase.hf.space npm run build
npm run serve
```

The deployed site picks up the same URL from `.env`, so nothing else is needed. To point one
deployment at a *different* Space, add a **repository variable** (not a secret — it is a public
URL) in GitHub: **Settings → Secrets and variables → Actions → Variables → New repository
variable**, named `PUBLIC_STEERING_SPACE`. The workflow uses it only when non-empty, so leaving it
unset keeps the `.env` default.

## 8. Confirm it in the browser

Open `/steering/`. The pill under the heading should read **"Measured from …"** and then switch to
**"Computed live just now by …"** once the Space answers. `?live=0` pins it to the recorded data.

## Changing the model

Set a **MODEL_ID** variable in the Space (**Settings → Variables and secrets**) to any causal LM
the code can load, e.g. `HuggingFaceTB/SmolLM2-360M-Instruct`. The layer and coefficient in
`steering_scenarios.py` were tuned for `Qwen2.5-0.5B-Instruct` and will need re-tuning for another
model — see [MEASUREMENT.md](MEASUREMENT.md).

The page always names the model that produced what is on screen, so a Space serving a different
model than the recorded measurements is self-explanatory rather than misleading.

## Things that will bite

- **Quotas are per visitor and small.** Unauthenticated visitors get roughly 2 minutes of GPU per
  day at low queue priority. One request computes a whole scenario, so a visitor costs three
  calls, not one per slider move — but a traffic spike still hits the ceiling. This is why the
  recorded measurements are the floor, not a placeholder.

  This is not hypothetical: it was hit during the first afternoon of testing. When it happens the
  Space answers normally but the result frame is an error object rather than the usual array:

  ```json
  {"title": "ZeroGPU quota exceeded", "error": "You have exceeded your ZeroGPU runs limit..."}
  ```

  The page then shows "Live run unavailable — showing the recorded measurement" with a Retry
  button, and stays completely usable. The allowance resets 24 hours after first use. To check
  the state of a Space by hand:

  ```bash
  SPACE=https://<you>-steering-showcase.hf.space
  EVENT=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"data":["movie-critic"]}' \
    "$SPACE/gradio_api/call/run_scenario" | python3 -c 'import sys,json;print(json.load(sys.stdin)["event_id"])')
  curl -s "$SPACE/gradio_api/call/run_scenario/$EVENT" | tail -2
  ```
- **A free Space sleeps when idle.** The first request afterwards starts the container and reloads
  the model. The client allows a generous timeout and falls back cleanly.
- **Do not commit the model.** `app.py` downloads it from the Hub at runtime. Nothing in the Space
  repository needs Git LFS.
- **Two Spaces maximum** on a free account.
