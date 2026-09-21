"""
Regression tests for the probability pipeline.

These exercise `steering_core` with synthetic distributions - no model is loaded and nothing here
is evidence about a model's behaviour. They cover the arithmetic between a measured softmax row
and the numbers the page ships, which is where an audit found values being silently destroyed.

Run with the measurement virtualenv, which is the only place torch is installed:

    .venv/bin/python -m unittest discover -s tests/python -v
"""

import sys
import unittest
from dataclasses import dataclass
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from steering_core import (  # noqa: E402
    STORED_SIGNIFICANT_DIGITS,
    StateMeasurement,
    probability_of,
    select_candidates,
    store_percent,
    to_payload,
)


@dataclass
class FakeSpec:
    id: str = "demo"
    title: str = "Demo"
    negative_label: str = "Left"
    positive_label: str = "Right"
    prompt: str = "A prompt."
    prefix: str = "A prefix"
    takeaway: str = "A takeaway."


def state(alpha: float, full: list, top_k: int, texts: dict) -> StateMeasurement:
    """A measurement whose full softmax row is `full`, with only `top_k` entries retained."""
    probs = torch.tensor(full, dtype=torch.float64)
    values, indices = torch.topk(probs, top_k)
    ids = [int(i) for i in indices.tolist()]
    return StateMeasurement(
        alpha=alpha,
        top_tokens=[texts[i] for i in ids],
        top_probs=[float(v) for v in values.tolist()],
        top_ids=ids,
        continuation=f"{texts[ids[0]].strip()} and so on.",
        truncated=False,
        full_probs=probs,
    )


class ProbabilityExtraction(unittest.TestCase):
    """The bug: a displayed candidate that falls outside another state's retained top-k."""

    def setUp(self):
        self.texts = {0: " alpha", 1: " beta", 2: " gamma", 3: " delta"}
        # ' beta' wins at the first state and is 4e-7 at the second, far outside a top-2 list.
        self.first = state(-2.0, [0.10, 0.60, 0.20, 0.10], top_k=2, texts=self.texts)
        self.second = state(2.0, [0.50, 4e-7, 0.30, 0.1999996], top_k=2, texts=self.texts)

    def test_reads_a_candidate_that_fell_outside_the_retained_top_k(self):
        beta = 1
        self.assertNotIn(beta, self.second.top_ids, "setup: beta must be outside the top-k")
        self.assertAlmostEqual(probability_of(self.second, beta), 4e-7, places=12)

    def test_without_the_full_row_the_value_is_unrecoverable(self):
        """Documents precisely what the old behaviour lost, so the fix cannot be undone quietly."""
        stripped = StateMeasurement(
            alpha=self.second.alpha,
            top_tokens=self.second.top_tokens,
            top_probs=self.second.top_probs,
            top_ids=self.second.top_ids,
            continuation=self.second.continuation,
        )
        self.assertEqual(probability_of(stripped, 1), 0.0)

    def test_candidates_are_tracked_by_id_not_by_decoded_text(self):
        texts = {0: " same", 1: " same", 2: " other", 3: " x"}
        a = state(-2.0, [0.7, 0.2, 0.05, 0.05], top_k=2, texts=texts)
        b = state(2.0, [0.2, 0.7, 0.05, 0.05], top_k=2, texts=texts)
        candidates = select_candidates([a, b])
        self.assertEqual([c.token_id for c in candidates], [0, 1])
        self.assertEqual([c.text for c in candidates], [" same", " same"])


class PayloadArithmetic(unittest.TestCase):
    def setUp(self):
        self.texts = {0: " alpha", 1: " beta", 2: " gamma", 3: " delta"}
        self.states = [
            state(-2.0, [0.10, 0.60, 0.20, 0.10], top_k=2, texts=self.texts),
            state(0.0, [0.30, 0.30000001, 0.20, 0.19999999], top_k=2, texts=self.texts),
            state(2.0, [0.50, 4e-7, 0.30, 0.1999996], top_k=2, texts=self.texts),
        ]
        self.payload = to_payload(FakeSpec(), self.states, layer=7, scale=1.0)

    def test_a_tiny_positive_probability_survives_into_the_payload(self):
        beta_column = self.payload["candidates"].index(" beta")
        value = self.payload["states"][-1]["percents"][beta_column]
        self.assertGreater(value, 0.0, "a real probability must not be stored as zero")
        self.assertAlmostEqual(value, 4e-5, places=10)

    def test_exact_zero_stays_exactly_zero(self):
        texts = {0: " a", 1: " b", 2: " c", 3: " d"}
        zero_states = [
            state(-2.0, [0.6, 0.4, 0.0, 0.0], top_k=4, texts=texts),
            state(2.0, [0.4, 0.6, 0.0, 0.0], top_k=4, texts=texts),
        ]
        payload = to_payload(FakeSpec(), zero_states, layer=1, scale=1.0)
        # ' c' is padded in as a third row and has genuinely no mass.
        column = payload["candidates"].index(" c")
        self.assertEqual(payload["states"][0]["percents"][column], 0.0)

    def test_other_is_computed_from_unrounded_probabilities(self):
        for row, measured in zip(self.payload["states"], self.states):
            exact = sum(
                probability_of(measured, candidate)
                for candidate in self.payload["candidate_ids"]
            )
            # The contract: Other is the remaining mass, taken before anything is rounded, and
            # only then written at the stored precision.
            self.assertEqual(row["other"], store_percent(1.0 - exact))
            self.assertAlmostEqual(sum(row["percents"]) + row["other"], 100.0, places=4)

    def test_other_no_longer_absorbs_the_candidates_rounding_error(self):
        """The old formula was 100 - sum(percentages already rounded to two decimals)."""
        texts = {0: " a", 1: " b", 2: " c", 3: " d"}
        skewed = [
            state(-2.0, [0.333333, 0.333333, 0.333334, 0.0], top_k=4, texts=texts),
            state(2.0, [0.111115, 0.444444, 0.444441, 0.0], top_k=4, texts=texts),
        ]
        payload = to_payload(FakeSpec(), skewed, layer=1, scale=1.0)
        for row, measured in zip(payload["states"], skewed):
            exact = [
                probability_of(measured, candidate) for candidate in payload["candidate_ids"]
            ]
            old_style = round(100.0 - sum(round(value * 100, 2) for value in exact), 2)
            self.assertEqual(row["other"], store_percent(1.0 - sum(exact)))
            # Both are close to the truth; the point is that the new one is not derived from
            # numbers that have already lost precision.
            self.assertNotEqual(row["other"], old_style)

    def test_selected_index_points_at_the_true_argmax(self):
        for row, measured in zip(self.payload["states"], self.states):
            winner = measured.top_ids[0]
            self.assertEqual(self.payload["candidate_ids"][row["selected_index"]], winner)
            self.assertEqual(self.payload["candidates"][row["selected_index"]], row["selected"])

    def test_continuation_starts_with_the_selected_token(self):
        for row in self.payload["states"]:
            self.assertTrue(row["continuation"].startswith(row["selected"].strip()))


class StorePercent(unittest.TestCase):
    def test_zero_and_near_zero_are_different_values(self):
        self.assertEqual(store_percent(0.0), 0.0)
        self.assertGreater(store_percent(1e-12), 0.0)

    def test_keeps_the_documented_number_of_significant_digits(self):
        self.assertEqual(STORED_SIGNIFICANT_DIGITS, 6)
        self.assertEqual(store_percent(0.123456789), 12.3457)

    def test_negative_input_is_clamped_rather_than_written_out(self):
        # Floating-point subtraction can make a remainder very slightly negative.
        self.assertEqual(store_percent(-1e-18), 0.0)


if __name__ == "__main__":
    unittest.main()


class LayerGuard(unittest.TestCase):
    """The last block is not a valid target: its hidden_states entry is post-norm."""

    def setUp(self):
        from types import SimpleNamespace
        from steering_core import check_layer

        layers = torch.nn.ModuleList([torch.nn.Identity() for _ in range(4)])
        self.model = SimpleNamespace(model=SimpleNamespace(layers=layers))
        self.check_layer = check_layer

    def test_accepts_every_block_but_the_last(self):
        for layer in (1, 2, 3):
            self.check_layer(self.model, layer)

    def test_rejects_the_last_block_and_out_of_range_values(self):
        for layer in (0, 4, 5, -1):
            with self.assertRaises(ValueError):
                self.check_layer(self.model, layer)

    def test_tuning_never_lands_on_the_last_block(self):
        from steering_scenarios import SCENARIOS, tuning_for

        for spec in SCENARIOS:
            for depth in (2, 3, 8, 24, 30):
                layer, _ = tuning_for("some/untuned-model", spec, depth)
                self.assertTrue(1 <= layer < depth, (spec.id, depth, layer))
            # A tuned entry deeper than a shallow model is clamped below its depth too.
            layer, _ = tuning_for("Qwen/Qwen2.5-0.5B-Instruct", spec, 8)
            self.assertLess(layer, 8)
