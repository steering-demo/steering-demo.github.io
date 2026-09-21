---
title: Steering Showcase API
emoji: 🎚️
colorFrom: blue
colorTo: gray
sdk: gradio
app_file: app.py
pinned: false
short_description: Live representation steering, measured not simulated
models:
  - Qwen/Qwen2.5-0.5B-Instruct
---

# Steering showcase — live API

Backs the interactive **Representation Steering Demo**.

`run_scenario(scenario_id)` returns JSON for all nine alpha states of one scenario: the model's
real next-token distribution at the position after the fixed prefix, and the continuation the
steered model generates with greedy decoding.

The intervention is `h' = h + alpha * coefficient * v`, with `v` a difference of means over
contrastive continuations, added to the residual stream at one decoder layer at every position.

Set the `MODEL_ID` Space variable to measure a different model.
