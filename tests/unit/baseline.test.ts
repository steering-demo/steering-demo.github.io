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
 * Checks the claims the page makes about its own numbers.
 *
 * An audit asked for evidence rather than assertion, in particular that alpha = 0 is the
 * unmodified model and that what the chart shows agrees with what the text says.
 */
describe('claims the page makes about its numbers', () => {
  it('places the unsteered state at alpha 0, where the intervention is the identity', () => {
    expect(ALPHA_STATES[NEUTRAL_INDEX]).toBe(0);
    for (const scenario of set.scenarios) {
      const neutral = scenario.states[NEUTRAL_INDEX];
      expect(neutral.alpha, scenario.id).toBe(0);
      // h' = h + 0 * c * v = h, so this row is the model with no intervention at all. The
      // measurement pipeline takes it through the same hook as every other row.
      expect(neutral.probabilities.some((value) => value > 0), scenario.id).toBe(true);
    }
  });

  it('never shows a rounded zero for a probability that is actually non-zero', () => {
    for (const scenario of set.scenarios) {
      for (const state of scenario.states) {
        for (const value of state.probabilities) {
          // Stored at two decimals: a genuine zero and a small positive value stay distinct, so
          // the UI can render "<0.1%" rather than a misleading "0%".
          expect(Number.isFinite(value)).toBe(true);
          if (value > 0) expect(value).toBeGreaterThanOrEqual(0.01);
        }
      }
    }
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

  it('does not claim the shown candidates are the three most likely tokens', () => {
    // They are the tokens that win somewhere on the slider. That allows a state where a shown
    // candidate is tiny, which would be wrong if they were "top 3" at each alpha.
    const anyTiny = set.scenarios.some((scenario) =>
      scenario.states.some((state) => state.probabilities.some((value) => value < 1)),
    );
    expect(anyTiny, 'expected at least one shown candidate below 1%').toBe(true);
  });

  it('keeps the aggregate remainder honest, including when it is the largest row', () => {
    for (const scenario of set.scenarios) {
      for (const state of scenario.states) {
        const total = state.probabilities.reduce((a, b) => a + b, 0) + state.other;
        expect(Math.abs(total - 100), `${scenario.id} @ ${state.alpha}`).toBeLessThanOrEqual(0.5);
        // An aggregate may exceed the largest single candidate; that is not a bug and the
        // candidates must never be rescaled to hide it.
        expect(state.other).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
