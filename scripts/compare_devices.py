#!/usr/bin/env python3
"""
Compares the recorded CPU measurements against the same scenarios run on the Space's GPU.

    python scripts/compare_devices.py                    # needs quota; see --token
    python scripts/compare_devices.py --token hf_...     # draw on an account's ZeroGPU quota

The offline pipeline and the Space share `steering_core.py`, but shared source is not evidence of
identical output: they run on different hardware with different kernels. This is the measurement
that settles what "the same procedure" is actually worth, and its result is recorded in
docs/MEASUREMENT.md.

Needs no torch - it reads docs/measurement-report.json and calls the live Space.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SPACE = "https://wang2226-steering-showcase.hf.space"


def call_space(space: str, scenario_id: str, token: Optional[str]) -> dict:
    """Runs one scenario on the Space, bypassing its cache, and returns the payload."""
    headers = {"content-type": "application/json"}
    if token:
        # ZeroGPU bills a run to the caller. Without a token that is the caller's IP address,
        # which has a much smaller daily allowance.
        headers["Authorization"] = f"Bearer {token}"

    start = urllib.request.Request(
        f"{space}/gradio_api/call/run_scenario_fresh",
        data=json.dumps({"data": [scenario_id]}).encode(),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(start, timeout=60) as response:
        event_id = json.load(response).get("event_id")
    if not event_id:
        raise RuntimeError(f"{scenario_id}: the Space did not start a job")

    stream = urllib.request.Request(
        f"{space}/gradio_api/call/run_scenario_fresh/{event_id}", headers=headers
    )
    with urllib.request.urlopen(stream, timeout=300) as response:
        body = response.read().decode()

    frames = [line[6:] for line in body.splitlines() if line.startswith("data: ")]
    if not frames:
        raise RuntimeError(f"{scenario_id}: the Space returned no data")
    parsed = json.loads(frames[-1])
    if isinstance(parsed, dict):
        raise RuntimeError(f"{scenario_id}: {json.dumps(parsed)[:200]}")
    payload = json.loads(parsed[0])
    if "error" in payload:
        raise RuntimeError(f"{scenario_id}: {payload['error'][:200]}")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--space", default=DEFAULT_SPACE)
    parser.add_argument("--token", help="Hugging Face token, to use its ZeroGPU quota")
    parser.add_argument("--report", default=str(ROOT / "docs" / "measurement-report.json"))
    args = parser.parse_args()

    report = json.loads(Path(args.report).read_text())
    cpu = {scenario["id"]: scenario for scenario in report["scenarios"]}
    print(f"recorded on {report['runtime']['device']}, {report['runtime']['dtype']}, "
          f"torch {report['runtime']['torch']}")

    worst = 0.0
    devices = set()
    argmax_differences = 0
    continuation_differences = 0
    compared = 0

    for scenario_id, recorded in cpu.items():
        try:
            live = call_space(args.space, scenario_id, args.token)
        except (urllib.error.URLError, RuntimeError) as error:
            print(f"  {scenario_id}: {error}")
            return 1

        if live["candidates"] != recorded["candidates"]:
            print(f"  {scenario_id}: different candidate tokens "
                  f"{live['candidates']} vs {recorded['candidates']}")
            argmax_differences += 1
            continue

        scenario_worst = 0.0
        for live_state, recorded_state in zip(live["states"], recorded["states"]):
            compared += 1
            pairs = zip(
                live_state["percents"] + [live_state["other"]],
                recorded_state["percents"] + [recorded_state["other"]],
            )
            for live_value, recorded_value in pairs:
                if live_value == 0 and recorded_value == 0:
                    continue
                denominator = max(abs(live_value), abs(recorded_value))
                scenario_worst = max(scenario_worst, abs(live_value - recorded_value) / denominator)
            if live_state["selected_index"] != recorded_state["selected_index"]:
                argmax_differences += 1
            if live_state["continuation"] != recorded_state["continuation"]:
                continuation_differences += 1

        worst = max(worst, scenario_worst)
        devices.add(live.get("gpu") or live.get("device") or "unrecorded")
        print(f"  {scenario_id:<20} worst relative difference {scenario_worst:.2e} "
              f"on {live.get('gpu') or live.get('device')}")

    # Name the hardware rather than assuming it: an older Space that does not report `gpu`
    # leaves this as the bare device string, which is the honest answer in that case.
    print(f"\ncompared against          : {', '.join(sorted(devices)) or 'unknown'}")
    print(f"states compared           : {compared}")
    print(f"worst relative difference : {worst:.2e}")
    print(f"argmax disagreements      : {argmax_differences}")
    print(f"continuation differences  : {continuation_differences}")
    # Agreement is not identity. A difference large enough to flip a near-tie would show up as an
    # argmax disagreement, which is the thing that would actually change the page.
    return 0 if argmax_differences == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
