/**
 * Typed access to the build-time generated scenario data.
 *
 * `scenarios.generated.json` is produced from `content/scenarios.md` by
 * `scripts/build-scenarios.ts` and is git-ignored. Run `npm run content:build` if it is missing.
 * Importing JSON here means Vite inlines the data into the bundle, so the recorded measurements
 * are on screen before any network request happens - including the optional live one.
 */
import generated from './scenarios.generated.json';
import type { Provenance, Scenario, ScenarioSet } from '../lib/types';

const set = generated as ScenarioSet;

export const scenarios: Scenario[] = set.scenarios;

/** Where the bundled numbers came from. Undefined if the content is authored, not measured. */
export const provenance: Provenance | undefined = set.provenance;

export const defaultScenario: Scenario = scenarios[0];
