import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  alphaToIndex,
  continuationStartsWithToken,
  parseScenarios,
  parseScenariosOrThrow,
  splitRow,
} from '../../scripts/parse-scenarios';
import { ALPHA_STATES } from '../../src/lib/types';

const CONTENT = readFileSync(
  fileURLToPath(new URL('../../content/scenarios.md', import.meta.url)),
  'utf8',
);

/** A minimal valid scenario. Each failure test breaks exactly one thing in this. */
const VALID = `## demo-scenario
Title: Demo
Negative label: Left
Positive label: Right
Prompt: Do a thing.
Prefix: The result was
Takeaway: Steering moves the first token.

| ID | Token |
| --- | --- |
| low | \` low\` |
| mid | \` mid\` |
| high | \` high\` |

| Alpha | low | mid | high | Other | Selected | Stopped | Continuation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| -2 | 70 | 15 | 5 | 10 | low | end | low and quiet. |
| -1.5 | 60 | 22 | 8 | 10 | low | end | low and quiet. |
| -1 | 50 | 30 | 10 | 10 | low | limit | low and quiet… |
| -0.5 | 35 | 40 | 15 | 10 | mid | end | mid and even. |
| 0 | 20 | 55 | 15 | 10 | mid | end | mid and even. |
| 0.5 | 15 | 40 | 35 | 10 | mid | end | mid and even. |
| 1 | 10 | 30 | 50 | 10 | high | end | high and loud. |
| 1.5 | 8 | 22 | 60 | 10 | high | end | high and loud. |
| 2 | 5 | 15 | 70 | 10 | high | end | high and loud. |
`;

/** Runs the parser on a mutated copy of VALID and returns the joined error text. */
function errorsFor(mutate: (source: string) => string): string {
  const { set, errors } = parseScenarios(mutate(VALID));
  expect(set, 'expected the parse to fail').toBeNull();
  return errors.map((issue) => issue.message).join('\n');
}

describe('row splitting', () => {
  it('drops the outer pipes and trims cells', () => {
    expect(splitRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
  });

  it('treats a backslash-escaped pipe as literal text', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
  });

  it('keeps an empty trailing cell that was written deliberately', () => {
    expect(splitRow('| a |  |')).toEqual(['a', '']);
  });
});

describe('alpha grid', () => {
  it('maps every declared state onto its index', () => {
    ALPHA_STATES.forEach((alpha, index) => expect(alphaToIndex(alpha)).toBe(index));
  });

  it('rejects off-grid and non-finite values', () => {
    for (const bad of [-2.5, 0.25, 1.75, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(alphaToIndex(bad)).toBe(-1);
    }
  });
});

describe('continuation prefix check', () => {
  it('ignores the token leading space and its case', () => {
    expect(continuationStartsWithToken('terrible-ish', ' terrible')).toBe(true);
    expect(continuationStartsWithToken('Terrible-ish', ' terrible')).toBe(true);
    expect(continuationStartsWithToken('wonderful', ' terrible')).toBe(false);
  });
});

describe('a valid scenario', () => {
  const { set, errors, warnings } = parseScenarios(VALID);

  it('parses with no errors or warnings', () => {
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(set?.scenarios).toHaveLength(1);
  });

  it('keeps the token leading space and exposes a trimmed label', () => {
    expect(set?.scenarios[0].candidates[0]).toEqual({ id: 'low', token: ' low', label: 'low' });
  });

  it('records why each generation stopped', () => {
    const states = set!.scenarios[0].states;
    expect(states.map((state) => state.truncated)).toEqual([
      false, false, true, false, false, false, false, false, false,
    ]);
  });

  it('orders the nine states by ascending alpha with matching indices', () => {
    const states = set!.scenarios[0].states;
    expect(states.map((state) => state.alpha)).toEqual([...ALPHA_STATES]);
    expect(states.map((state) => state.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('validation catches', () => {
  it('a duplicate scenario id', () => {
    expect(errorsFor((s) => `${s}\n${s}`)).toMatch(/Duplicate scenario id "demo-scenario"/);
  });

  it('a missing required field', () => {
    expect(errorsFor((s) => s.replace('Prefix: The result was\n', ''))).toMatch(
      /Missing required field "prefix"/,
    );
  });

  it('an unknown field', () => {
    expect(errorsFor((s) => s.replace('Title: Demo', 'Titel: Demo'))).toMatch(
      /Unknown field "Titel"\. Expected one of: title, negative label/,
    );
  });

  it('a missing alpha state', () => {
    expect(errorsFor((s) => s.replace('| -1 | 50 | 30 | 10 | 10 | low | limit | low and quiet… |\n', ''))).toMatch(
      /Missing steering state for alpha -1/,
    );
  });

  it('a duplicate alpha state', () => {
    expect(errorsFor((s) => s.replace('| -1.5 | 60', '| -2 | 60'))).toMatch(/Duplicate alpha -2/);
  });

  it('an off-grid alpha state', () => {
    expect(errorsFor((s) => s.replace('| -1.5 | 60', '| -1.25 | 60'))).toMatch(
      /Alpha -1\.25 is off the grid/,
    );
  });

  it('a non-numeric percentage', () => {
    expect(errorsFor((s) => s.replace('| 0 | 20 | 55', '| 0 | NaN | 55'))).toMatch(
      /"low" "NaN" is not a finite number/,
    );
  });

  it('a percentage outside 0-100', () => {
    expect(errorsFor((s) => s.replace('| 0 | 20 | 55 | 15 | 10', '| 0 | 120 | 55 | 15 | -90'))).toMatch(
      /is 120, outside the allowed 0-100 range/,
    );
  });

  it('a distribution that does not total 100', () => {
    expect(errorsFor((s) => s.replace('| 0 | 20 | 55 | 15 | 10', '| 0 | 20 | 55 | 15 | 20'))).toMatch(
      /percentages sum to 110, expected 100 \(tolerance 0\.5\)/,
    );
  });

  it('an unknown selected candidate', () => {
    expect(errorsFor((s) => s.replace('| 10 | mid | end | mid and even. |', '| 10 | middle | end | mid and even. |'))).toMatch(
      /Selected "middle" is not a declared candidate\. Known ids: low, mid, high/,
    );
  });

  it('a selected candidate that is not the highest', () => {
    expect(errorsFor((s) => s.replace('| 0 | 20 | 55 | 15 | 10 | mid | end |', '| 0 | 20 | 55 | 15 | 10 | low | end |'))).toMatch(
      /Selected is "low" \(20%\) but the highest candidate is "mid" \(55%\)/,
    );
  });

  it('a continuation that does not start with the selected token', () => {
    expect(errorsFor((s) => s.replace('| high | end | high and loud. |\n| 1.5', '| high | end | loud and high. |\n| 1.5'))).toMatch(
      /Continuation must begin with the selected token "high" but begins with "loud and high\."/,
    );
  });

  it('a token that is not a code span', () => {
    expect(errorsFor((s) => s.replace('| low | ` low` |', '| low | low |'))).toMatch(
      /token must be wrapped in single backticks/,
    );
  });

  it('a duplicate candidate id', () => {
    expect(errorsFor((s) => s.replace('| mid | ` mid` |', '| low | ` mid` |'))).toMatch(
      /Duplicate candidate id "low"/,
    );
  });

  it('a table row split across lines', () => {
    expect(errorsFor((s) => s.replace('| 2 | 5 | 15 | 70 | 10 | high | end | high and loud. |', '| 2 | 5 | 15 | 70 | 10 | high | end | high and\nloud. |'))).toMatch(
      /cells, expected 7|must stay on one line/,
    );
  });

  it('a missing table separator row', () => {
    expect(errorsFor((s) => s.replace('| ID | Token |\n| --- | --- |', '| ID | Token |'))).toMatch(
      /missing its `\| --- \| --- \|` separator row/,
    );
  });

  it('an unknown Stopped value', () => {
    expect(errorsFor((s) => s.replace('| low | end | low and quiet. |', '| low | maybe | low and quiet. |'))).toMatch(
      /Stopped is "maybe"; expected "end" .* or "limit"/,
    );
  });

  it('a file with no scenarios at all', () => {
    const { set, errors } = parseScenarios('Just some prose, no headings.');
    expect(set).toBeNull();
    expect(errors[0].message).toMatch(/No scenarios found/);
  });

  it('and names the scenario and line for every problem', () => {
    const { errors } = parseScenarios(VALID.replace('Title: Demo', 'Titel: Demo'));
    expect(errors[0].scenario).toBe('demo-scenario');
    expect(errors[0].line).toBeGreaterThan(0);
  });
});

describe('warnings', () => {
  it('flag an Other share above the largest candidate without failing the build', () => {
    const { set, warnings } = parseScenarios(
      VALID.replace('| 0 | 20 | 55 | 15 | 10 | mid |', '| 0 | 20 | 25 | 15 | 40 | mid |'),
    );
    expect(set).not.toBeNull();
    expect(warnings.map((w) => w.message).join('\n')).toMatch(/"Other" \(40%\) exceeds/);
  });
});

describe('the shipped content', () => {
  const { set, warnings } = parseScenariosOrThrow(CONTENT, 'content/scenarios.md');
  const scenarios = set.scenarios;

  it('parses without errors', () => {
    // Warnings are expected: a real model spreads probability over a large vocabulary, so the
    // aggregated "Other" row is often the biggest one. That is a measurement, not a mistake.
    expect(scenarios.length).toBeGreaterThan(0);
    expect(warnings.every((issue) => /Other/.test(issue.message))).toBe(true);
  });

  it('records where the numbers came from', () => {
    expect(set.provenance?.model, 'provenance is required once content is measured').toBeTruthy();
    expect(set.provenance?.method).toMatch(/difference of means/i);
    expect(set.provenance?.measured).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('names the layer and coefficient the intervention used', () => {
    for (const scenario of scenarios) {
      expect(scenario.layer, scenario.id).toBeGreaterThan(0);
      expect(scenario.coefficient, scenario.id).toBeGreaterThan(0);
    }
  });

  it('has the three scenarios in order', () => {
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      'movie-critic',
      'animal-enthusiast',
      'storyteller',
    ]);
  });

  it('keeps the authored prompts and prefixes', () => {
    const [movie, animals, story] = scenarios;
    expect(movie.prompt).toBe(
      'Give a one-sentence review of the fictional movie Midnight on Mars.',
    );
    expect(animals.prompt).toBe('Describe your ideal afternoon with a pet.');
    expect(story.prompt).toBe('Describe someone opening a door.');

    // Each prefix ends on an intensifier so the very next token carries the meaning.
    expect(movie.prefix.startsWith('The movie was')).toBe(true);
    expect(animals.prefix).toBe("I'd spend the afternoon with a");
    expect(story.prefix.startsWith('The door opened')).toBe(true);
  });

  it('gives every scenario nine states summing to 100', () => {
    for (const scenario of scenarios) {
      expect(scenario.states).toHaveLength(9);
      for (const state of scenario.states) {
        const total = state.probabilities.reduce((a, b) => a + b, 0) + state.other;
        expect(Math.abs(total - 100), `${scenario.id} at alpha ${state.alpha}`).toBeLessThanOrEqual(
          0.5,
        );
      }
    }
  });

  it('starts every continuation with the selected candidate, which is the argmax', () => {
    for (const scenario of scenarios) {
      for (const state of scenario.states) {
        const max = Math.max(...state.probabilities);
        expect(state.probabilities[state.selectedIndex]).toBe(max);
        const token = scenario.candidates[state.selectedIndex].label;
        expect(state.continuation.toLowerCase().startsWith(token.toLowerCase())).toBe(true);
      }
    }
  });

  it('keeps every token a real word-level token with a leading space', () => {
    for (const scenario of scenarios) {
      expect(scenario.candidates.length).toBeGreaterThanOrEqual(2);
      for (const candidate of scenario.candidates) {
        expect(candidate.token.startsWith(' '), candidate.token).toBe(true);
        expect(candidate.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('moves the winning token across the slider in every scenario', () => {
    for (const scenario of scenarios) {
      const first = scenario.states[0].selectedId;
      const last = scenario.states[8].selectedId;
      expect(first, `${scenario.id} should not end where it started`).not.toBe(last);
    }
  });

  it('places the neutral state at alpha 0 for every scenario', () => {
    for (const scenario of scenarios) {
      expect(scenario.states[4].alpha).toBe(0);
    }
  });
});

describe('extensibility', () => {
  it('accepts a fourth scenario with no code change', () => {
    const fourth = VALID.replace('## demo-scenario', '## another-demo').replace(
      'Title: Demo',
      'Title: Another Demo',
    );
    const { set, errors } = parseScenarios(`${CONTENT}\n${fourth}`);
    expect(errors).toEqual([]);
    expect(set?.scenarios.map((s) => s.id)).toEqual([
      'movie-critic',
      'animal-enthusiast',
      'storyteller',
      'another-demo',
    ]);
  });
});
