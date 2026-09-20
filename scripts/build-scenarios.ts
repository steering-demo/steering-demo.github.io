/**
 * CLI wrapper around the scenario parser.
 *
 *   tsx scripts/build-scenarios.ts            validate and regenerate the static JSON
 *   tsx scripts/build-scenarios.ts --check    validate only, write nothing
 *   tsx scripts/build-scenarios.ts --strict   treat warnings as errors
 *
 * Exits non-zero on any validation error, which is what stops a bad edit from reaching a
 * deployment.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ScenarioContentError, formatIssue, parseScenarios } from './parse-scenarios';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_PATH = resolve(ROOT, 'content/scenarios.md');
export const OUTPUT_PATH = resolve(ROOT, 'src/data/scenarios.generated.json');

function main(argv: string[]): number {
  const checkOnly = argv.includes('--check');
  const strict = argv.includes('--strict');
  const sourceName = relative(ROOT, SOURCE_PATH);

  if (!existsSync(SOURCE_PATH)) {
    process.stderr.write(`error  missing content file: ${sourceName}\n`);
    return 1;
  }

  const source = readFileSync(SOURCE_PATH, 'utf8');
  const { set, errors, warnings } = parseScenarios(source);

  for (const warning of warnings) {
    process.stderr.write(`warning  ${formatIssue(warning, sourceName)}\n`);
  }

  if (!set) {
    process.stderr.write(`\n${new ScenarioContentError(errors, sourceName).message}\n\n`);
    process.stderr.write('Fix the lines above and re-run. See docs/SCENARIOS.md for the format.\n');
    return 1;
  }

  if (strict && warnings.length > 0) {
    process.stderr.write(`\n${warnings.length} warning(s) with --strict; failing.\n`);
    return 1;
  }

  const stateCount = set.scenarios.reduce((n, s) => n + s.states.length, 0);
  const summary = `${set.scenarios.length} scenario(s), ${stateCount} steering states`;

  if (checkOnly) {
    process.stdout.write(`ok  ${sourceName} is valid: ${summary}\n`);
    return 0;
  }

  const json = `${JSON.stringify(set, null, 2)}\n`;
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const unchanged = existsSync(OUTPUT_PATH) && readFileSync(OUTPUT_PATH, 'utf8') === json;
  if (!unchanged) writeFileSync(OUTPUT_PATH, json, 'utf8');

  process.stdout.write(
    `ok  ${summary} -> ${relative(ROOT, OUTPUT_PATH)}${unchanged ? ' (unchanged)' : ''}\n`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).replace(/\.[cm]?[jt]s$/, '') === resolve(ROOT, 'scripts/build-scenarios');

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
