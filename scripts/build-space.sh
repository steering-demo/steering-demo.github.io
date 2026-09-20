#!/usr/bin/env bash
# Copies the shared measurement modules into space/ so the Space and the offline pipeline run
# identical code. Run this before every deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf space/__pycache__
cp scripts/steering_core.py scripts/steering_scenarios.py space/
echo "synced steering_core.py and steering_scenarios.py into space/"
echo
echo "Files to deploy:"
ls -1 space/app.py space/requirements.txt space/README.md \
      space/steering_core.py space/steering_scenarios.py | sed 's/^/  /'
echo
echo "Full instructions: docs/DEPLOY-SPACE.md"
echo
echo "  1. Create a PUBLIC Gradio Space on ZeroGPU:  https://huggingface.co/new-space"
echo "  2. git clone https://huggingface.co/spaces/<you>/<space> /tmp/hf-space"
echo "  3. cp space/app.py space/requirements.txt space/README.md \\"
echo "        space/steering_core.py space/steering_scenarios.py /tmp/hf-space/"
echo "  4. cd /tmp/hf-space && git add -A && git commit -m deploy && git push"
echo "     (username = your HF username, password = a write token)"
echo "  5. PUBLIC_STEERING_SPACE=https://<you>-<space>.hf.space npm run build"
