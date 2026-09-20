import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ALPHA_STATES, NEUTRAL_INDEX } from '../../src/lib/types';
import { parseScenariosOrThrow } from '../../scripts/parse-scenarios';

const CONTENT = readFileSync(
  fileURLToPath(new URL('../../content/scenarios.md', import.meta.url)),
  'utf8',
);
const { set } = parseScenariosOrThrow(CONTENT, 'content/scenarios.md');

/**
 * Checks on the shipped data file, and only on it.
 *
 * These read `content/scenarios.md` after it has been written. They can prove that the file is
 * internally consistent and in the shape the page expects. They cannot prove anything about the
 * model that produced it: a value already destroyed before it was written looks perfectly
 * well-formed here. An earlier version of this file was named for the claims it was checking
 * rather than for what it actually inspects, which flattered it.
 *
 * Evidence about the pipeline that produces these numbers is in
 * `tests/python/test_steering_core.py`; evidence about the model is in
 * `docs/measurement-report.json`, written by the measurement run itself.
 */
describe('the shipped content file', () => {
  it('puts alpha 0 at the neutral index, where the page reads its reference row', () => {
    expect(ALPHA_STATES[NEUTRAL_INDEX]).toBe(0);
    for (const scenario of set.scenarios) {
      expect(scenario.states[NEUTRAL_INDEX].alpha, scenario.id).toBe(0);
    }
  });

  it('carries a model and a pinned revision for the numbers it contains', () => {
    // Naming a model without its revision is only half an answer, and the page shows both.
    expect(set.provenance?.model).toBeTruthy();
    expect(set.provenance?.revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it('stores probabilities as finite values in range, with zero reserved for zero', () => {
    for (const scenario of set.scenarios) {
      for (const state of scenario.states) {
        for (const value of state.probabilities) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('keeps values that the old two-decimal rounding would have flattened to zero', () => {
    // Not proof that nothing was lost - only the pipeline can establish that. It is a guard that
    // the file still has the resolution the fix introduced, so a regression in the writer shows
    // up here rather than silently on the page.
    const tiny = set.scenarios.flatMap((scenario) =>
      scenario.states.flatMap((state) => state.probabilities.filter((v) => v > 0 && v < 0.005)),
    );
    expect(tiny.length, 'expected sub-0.005% values to survive serialisation').toBeGreaterThan(0);
  });

  it('records a stop reason for every generation, and marks cut-off text', () => {
    for (const scenario of set.scenarios) {
      for (const state of scenario.states) {
        expect(typeof state.truncated, `${scenario.id} @ ${state.alpha}`).toBe('boolean');
        // The ellipsis means exactly one thing: generation hit the token limit.
        expect(state.continuation.endsWith('…')).toBe(state.truncated);
      }
    }
  });

  it('does not present the shown candidates as the three most likely tokens', () => {
    // They are the tokens that win somewhere on the slider. That allows a state where a shown
    // candidate is tiny, which would be wrong if they were "top 3" at each alpha.
    const anyTiny = set.scenarios.some((scenario) =>
      scenario.states.some((state) => state.probabilities.some((value) => value < 1)),
    );
    expect(anyTiny, 'expected at least one shown candidate below 1%').toBe(true);
  });

  it('sums each state to 100 well inside the tolerance the parser allows', () => {
    for (const scenario of set.scenarios) {
      for (const state of scenario.states) {
        const total = state.probabilities.reduce((a, b) => a + b, 0) + state.other;
        // "Other" is now derived from unrounded probabilities, so the residual is far smaller
        // than the 0.5 the format tolerates. Holding it to 0.01 catches a regression to the old
        // subtract-the-rounded-values arithmetic.
        expect(Math.abs(total - 100), `${scenario.id} @ ${state.alpha}`).toBeLessThan(0.01);
        expect(state.other).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('starts every continuation with the token the chart marks as selected', () => {
    for (const scenario of set.scenarios) {
      for (const state of scenario.states) {
        const label = scenario.candidates[state.selectedIndex].label;
        expect(state.continuation.startsWith(label), `${scenario.id} @ ${state.alpha}`).toBe(true);
      }
    }
  });
});
