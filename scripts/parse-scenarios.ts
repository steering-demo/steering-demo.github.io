/**
 * Build-time parser and validator for `content/scenarios.md`.
 *
 * Pure functions over a string so the same code runs in tests. The CLI wrapper that reads and
 * writes files lives in `build-scenarios.ts`.
 *
 * The format is deliberately boring: `## id` starts a scenario, `Key: value` lines carry the
 * text, and two Markdown tables carry the candidates and the nine steering states. Authors
 * should never have to touch JSON.
 */

import {
  ALPHA_STATES,
  alphaToIndex,
  SUM_TOLERANCE,
  type Candidate,
  type Provenance,
  type Scenario,
  type ScenarioSet,
  type SteeringState,
} from '../src/lib/types';

export interface ContentIssue {
  /** 1-based line number in the source file. */
  line: number;
  scenario?: string;
  message: string;
}

export interface ParseOutcome {
  /** Null when `errors` is non-empty. */
  set: ScenarioSet | null;
  errors: ContentIssue[];
  warnings: ContentIssue[];
}

export class ScenarioContentError extends Error {
  readonly issues: ContentIssue[];

  constructor(issues: ContentIssue[], sourceName: string) {
    const body = issues.map((i) => `  ${formatIssue(i, sourceName)}`).join('\n');
    super(`${issues.length} problem${issues.length === 1 ? '' : 's'} in ${sourceName}:\n${body}`);
    this.name = 'ScenarioContentError';
    this.issues = issues;
  }
}

export function formatIssue(issue: ContentIssue, sourceName: string): string {
  const where = issue.scenario ? ` [${issue.scenario}]` : '';
  return `${sourceName}:${issue.line}${where} ${issue.message}`;
}

const FIELD_KEYS = {
  title: 'title',
  'negative label': 'negativeLabel',
  'positive label': 'positiveLabel',
  prompt: 'prompt',
  prefix: 'prefix',
  takeaway: 'takeaway',
  layer: 'layer',
  coefficient: 'coefficient',
} as const;

type FieldName = (typeof FIELD_KEYS)[keyof typeof FIELD_KEYS];

const REQUIRED_FIELDS: FieldName[] = [
  'title',
  'negativeLabel',
  'positiveLabel',
  'prompt',
  'prefix',
  'takeaway',
];

const PROVENANCE_KEYS: Record<string, keyof Provenance> = {
  model: 'model',
  revision: 'revision',
  method: 'method',
  measured: 'measured',
};

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Exponent notation is accepted because measured probabilities span many orders of
// magnitude: a candidate that wins at one end of the slider can be genuinely tiny at the
// other, and writing it as 0.00 would be the rounding bug this format exists to avoid.
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const SEPARATOR_CELL = /^:?-{1,}:?$/;
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 6;

interface SourceLine {
  n: number;
  raw: string;
}

interface TableBlock {
  headerLine: number;
  header: string[];
  rows: { line: number; cells: string[] }[];
}

/**
 * Splits one Markdown table row into trimmed cells.
 *
 * `\|` yields a literal pipe and `\\` a literal backslash; every other backslash is kept as
 * written. The outer pipes are not cells.
 */
export function splitRow(raw: string): string[] {
  const line = raw.trim();
  const cells: string[] = [];
  let current = '';
  let i = line.startsWith('|') ? 1 : 0;

  for (; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      const next = line[i + 1];
      if (next === '|' || next === '\\') {
        current += next;
        i += 1;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

function isTableRow(raw: string): boolean {
  return raw.trim().startsWith('|');
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));
}

/** Reads a code span, preserving every character between the backticks verbatim. */
function readCodeSpan(cell: string): string | null {
  const match = /^`([^`]*)`$/.exec(cell);
  return match ? match[1] : null;
}

// Re-exported so tests and tooling can reach it through the parser module too.
export { alphaToIndex };

/** True when `continuation` begins with `token`, ignoring the token's leading space and case. */
export function continuationStartsWithToken(continuation: string, token: string): boolean {
  const needle = token.replace(/^\s+/, '');
  if (needle.length === 0) return false;
  return continuation.slice(0, needle.length).toLowerCase() === needle.toLowerCase();
}

export function parseScenarios(source: string): ParseOutcome {
  const errors: ContentIssue[] = [];
  const warnings: ContentIssue[] = [];
  const lines: SourceLine[] = source.split(/\r?\n/).map((raw, i) => ({ n: i + 1, raw }));

  // Split the file into `## id` sections. The preamble above the first one is prose, except for
  // the optional provenance lines that say where the numbers came from.
  const sections: { id: string; line: number; body: SourceLine[] }[] = [];
  const provenanceFields: Partial<Provenance> = {};
  for (const line of lines) {
    const heading = /^##(?!#)\s*(.*)$/.exec(line.raw);
    if (heading) {
      sections.push({ id: heading[1].trim(), line: line.n, body: [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1].body.push(line);
    } else {
      const field = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.+)$/.exec(line.raw.trim());
      const key = field ? field[1].trim().toLowerCase() : null;
      if (field && key && key in PROVENANCE_KEYS) {
        provenanceFields[PROVENANCE_KEYS[key]] = field[2].trim();
      }
    }
  }

  const provenance: Provenance | undefined =
    provenanceFields.model && provenanceFields.method && provenanceFields.measured
      ? (provenanceFields as Provenance)
      : undefined;

  if (sections.length === 0) {
    errors.push({
      line: 1,
      message: 'No scenarios found. A scenario starts at a `## scenario-id` heading.',
    });
    return { set: null, errors, warnings };
  }

  const scenarios: Scenario[] = [];
  const seenIds = new Map<string, number>();

  for (const section of sections) {
    const scenario = parseSection(section, errors, warnings, seenIds);
    if (scenario) scenarios.push(scenario);
  }

  if (errors.length > 0) return { set: null, errors, warnings };
  return { set: provenance ? { scenarios, provenance } : { scenarios }, errors, warnings };
}

function parseSection(
  section: { id: string; line: number; body: SourceLine[] },
  errors: ContentIssue[],
  warnings: ContentIssue[],
  seenIds: Map<string, number>,
): Scenario | null {
  const id = section.id;
  const before = errors.length;
  const fail = (line: number, message: string) => errors.push({ line, scenario: id || undefined, message });

  if (!id) {
    fail(section.line, 'Scenario heading has no id. Use `## scenario-id`.');
    return null;
  }
  if (!ID_PATTERN.test(id)) {
    fail(
      section.line,
      `Invalid scenario id "${id}". Use lowercase letters, digits and single hyphens, e.g. \`## movie-critic\`.`,
    );
  }
  const previous = seenIds.get(id);
  if (previous !== undefined) {
    fail(section.line, `Duplicate scenario id "${id}" (first defined on line ${previous}).`);
  } else {
    seenIds.set(id, section.line);
  }

  // Walk the section, collecting `Key: value` fields and table blocks.
  const fields = new Map<FieldName, { value: string; line: number }>();
  const tables: TableBlock[] = [];

  for (let i = 0; i < section.body.length; i += 1) {
    const line = section.body[i];
    const text = line.raw.trim();
    if (text === '' || /^(?:-{3,}|\*{3,}|_{3,})$/.test(text)) continue;
    if (/^<!--[\s\S]*-->$/.test(text)) continue; // single-line author note

    if (isTableRow(line.raw)) {
      const rows: { line: number; cells: string[] }[] = [];
      while (i < section.body.length && isTableRow(section.body[i].raw)) {
        rows.push({ line: section.body[i].n, cells: splitRow(section.body[i].raw) });
        i += 1;
      }
      i -= 1;
      const header = rows.shift();
      if (!header) continue;
      if (rows.length > 0 && isSeparatorRow(rows[0].cells)) {
        rows.shift();
      } else {
        fail(
          header.line + 1,
          'Table is missing its `| --- | --- |` separator row directly under the header.',
        );
      }
      tables.push({ headerLine: header.line, header: header.cells, rows });
      continue;
    }

    const field = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(text);
    const key = field ? field[1].trim().toLowerCase().replace(/\s+/g, ' ') : null;
    if (field && key && key in FIELD_KEYS) {
      const name = FIELD_KEYS[key as keyof typeof FIELD_KEYS];
      const value = field[2].trim();
      if (fields.has(name)) {
        fail(line.n, `Duplicate field "${field[1].trim()}" (first set on line ${fields.get(name)!.line}).`);
      } else if (value === '') {
        fail(line.n, `Field "${field[1].trim()}" is empty.`);
      } else {
        fields.set(name, { value, line: line.n });
      }
      continue;
    }

    if (field && key) {
      fail(
        line.n,
        `Unknown field "${field[1].trim()}". Expected one of: ${Object.keys(FIELD_KEYS).join(', ')}.`,
      );
      continue;
    }

    fail(
      line.n,
      `Unrecognized line: ${JSON.stringify(text.slice(0, 60))}. Expected a \`Key: value\` field or a table row starting with \`|\`.` +
        (text.includes('|')
          ? ' If this continues the cell above, note that a table cell must stay on one line; write a literal pipe as `\\|`.'
          : ''),
    );
  }

  for (const name of REQUIRED_FIELDS) {
    if (!fields.has(name)) {
      const label = Object.keys(FIELD_KEYS).find(
        (k) => FIELD_KEYS[k as keyof typeof FIELD_KEYS] === name,
      );
      fail(section.line, `Missing required field "${label}".`);
    }
  }

  if (tables.length !== 2) {
    fail(
      section.line,
      `Expected 2 tables (candidate tokens, then the nine steering states) but found ${tables.length}.`,
    );
    return null;
  }

  const candidates = parseCandidateTable(tables[0], id, errors, warnings);
  if (!candidates) return null;

  const states = parseStateTable(tables[1], candidates, id, errors, warnings);

  if (errors.length > before) return null;

  const numericField = (name: FieldName, label: string): number | undefined => {
    const raw = fields.get(name);
    if (!raw) return undefined;
    if (!NUMBER_PATTERN.test(raw.value)) {
      fail(raw.line, `Field "${label}" must be a number but is ${JSON.stringify(raw.value)}.`);
      return undefined;
    }
    return Number(raw.value);
  };
  const layer = numericField('layer', 'Layer');
  const coefficient = numericField('coefficient', 'Coefficient');

  if (errors.length > before) return null;

  return {
    id,
    title: fields.get('title')!.value,
    negativeLabel: fields.get('negativeLabel')!.value,
    positiveLabel: fields.get('positiveLabel')!.value,
    prompt: fields.get('prompt')!.value,
    prefix: fields.get('prefix')!.value,
    takeaway: fields.get('takeaway')!.value,
    candidates,
    states: states!,
    ...(layer === undefined ? {} : { layer }),
    ...(coefficient === undefined ? {} : { coefficient }),
  };
}

function parseCandidateTable(
  table: TableBlock,
  id: string,
  errors: ContentIssue[],
  warnings: ContentIssue[],
): Candidate[] | null {
  const fail = (line: number, message: string) => errors.push({ line, scenario: id, message });
  const header = table.header.map((h) => h.toLowerCase());

  if (header.length !== 2 || header[0] !== 'id' || header[1] !== 'token') {
    fail(
      table.headerLine,
      `Candidate table header must be \`| ID | Token |\` but is \`| ${table.header.join(' | ')} |\`.`,
    );
    return null;
  }

  const candidates: Candidate[] = [];
  const seen = new Map<string, number>();
  const seenTokens = new Map<string, number>();

  for (const row of table.rows) {
    if (row.cells.length !== 2) {
      fail(row.line, `Candidate row has ${row.cells.length} cells, expected 2 (ID and Token).`);
      continue;
    }
    const [rawId, rawToken] = row.cells;
    if (!ID_PATTERN.test(rawId)) {
      fail(row.line, `Invalid candidate id "${rawId}". Use lowercase letters, digits and single hyphens.`);
      continue;
    }
    if (seen.has(rawId)) {
      fail(row.line, `Duplicate candidate id "${rawId}" (first defined on line ${seen.get(rawId)}).`);
      continue;
    }
    const token = readCodeSpan(rawToken);
    if (token === null) {
      fail(
        row.line,
        `Candidate "${rawId}" token must be wrapped in single backticks, e.g. \`\` \` terrible\` \`\`. Found ${JSON.stringify(rawToken)}.`,
      );
      continue;
    }
    if (token.trim() === '') {
      fail(row.line, `Candidate "${rawId}" has an empty token.`);
      continue;
    }
    if (seenTokens.has(token)) {
      fail(row.line, `Duplicate token ${JSON.stringify(token)} (first used on line ${seenTokens.get(token)}).`);
      continue;
    }
    if (!token.startsWith(' ')) {
      warnings.push({
        line: row.line,
        scenario: id,
        message: `Token ${JSON.stringify(token)} has no leading space. Word-level tokens normally start with one.`,
      });
    }
    seen.set(rawId, row.line);
    seenTokens.set(token, row.line);
    candidates.push({ id: rawId, token, label: token.replace(/^\s+/, '') });
  }

  if (candidates.length < MIN_CANDIDATES) {
    fail(table.headerLine, `A scenario needs at least ${MIN_CANDIDATES} candidate tokens, found ${candidates.length}.`);
    return null;
  }
  if (candidates.length > MAX_CANDIDATES) {
    fail(table.headerLine, `A scenario supports at most ${MAX_CANDIDATES} candidate tokens, found ${candidates.length}.`);
    return null;
  }
  return candidates;
}

function parseStateTable(
  table: TableBlock,
  candidates: Candidate[],
  id: string,
  errors: ContentIssue[],
  warnings: ContentIssue[],
): SteeringState[] | null {
  const before = errors.length;
  const fail = (line: number, message: string) => errors.push({ line, scenario: id, message });

  const expected = [
    'alpha',
    ...candidates.map((c) => c.id),
    'other',
    'selected',
    'stopped',
    'continuation',
  ];
  const header = table.header.map((h) => h.toLowerCase());
  const column = new Map<string, number>();
  let headerOk = true;

  header.forEach((name, index) => {
    if (column.has(name)) {
      fail(table.headerLine, `Duplicate column "${table.header[index]}" in the steering-state table.`);
      headerOk = false;
      return;
    }
    column.set(name, index);
  });

  for (const name of expected) {
    if (!column.has(name)) {
      fail(
        table.headerLine,
        `Steering-state table is missing the "${name}" column. Expected columns: ${expected.join(', ')}.`,
      );
      headerOk = false;
    }
  }
  for (const name of header) {
    if (!expected.includes(name)) {
      fail(
        table.headerLine,
        `Unexpected column "${name}" in the steering-state table. Expected columns: ${expected.join(', ')}.`,
      );
      headerOk = false;
    }
  }
  if (!headerOk) return null;

  const states: SteeringState[] = [];
  const seenIndex = new Map<number, number>();

  for (const row of table.rows) {
    if (row.cells.length !== header.length) {
      fail(
        row.line,
        `Row has ${row.cells.length} cells, expected ${header.length}. A cell must stay on one line; write a literal pipe as \`\\|\`.`,
      );
      continue;
    }
    const cell = (name: string) => row.cells[column.get(name)!];

    const alphaText = cell('alpha');
    if (!NUMBER_PATTERN.test(alphaText)) {
      fail(row.line, `Alpha "${alphaText}" is not a number. Use one of: ${ALPHA_STATES.join(', ')}.`);
      continue;
    }
    const alpha = Number(alphaText);
    const index = alphaToIndex(alpha);
    if (index === -1) {
      fail(row.line, `Alpha ${alphaText} is off the grid. Use one of: ${ALPHA_STATES.join(', ')}.`);
      continue;
    }
    if (seenIndex.has(index)) {
      fail(row.line, `Duplicate alpha ${alphaText} (first defined on line ${seenIndex.get(index)}).`);
      continue;
    }

    let numbersOk = true;
    const readPercent = (name: string, label: string): number => {
      const text = cell(name);
      if (!NUMBER_PATTERN.test(text)) {
        fail(row.line, `Alpha ${alphaText}: ${label} "${text}" is not a finite number.`);
        numbersOk = false;
        return Number.NaN;
      }
      const value = Number(text);
      if (!Number.isFinite(value)) {
        fail(row.line, `Alpha ${alphaText}: ${label} "${text}" is not a finite number.`);
        numbersOk = false;
        return Number.NaN;
      }
      if (value < 0 || value > 100) {
        fail(row.line, `Alpha ${alphaText}: ${label} is ${value}, outside the allowed 0-100 range.`);
        numbersOk = false;
        return Number.NaN;
      }
      return value;
    };

    const probabilities = candidates.map((c) => readPercent(c.id, `"${c.id}"`));
    const other = readPercent('other', '"Other"');
    if (!numbersOk) continue;

    const total = probabilities.reduce((a, b) => a + b, 0) + other;
    if (Math.abs(total - 100) > SUM_TOLERANCE) {
      fail(
        row.line,
        `Alpha ${alphaText}: percentages sum to ${round(total)}, expected 100 (tolerance ${SUM_TOLERANCE}).`,
      );
      continue;
    }

    const selectedId = cell('selected');
    const selectedIndex = candidates.findIndex((c) => c.id === selectedId);
    if (selectedIndex === -1) {
      fail(
        row.line,
        `Alpha ${alphaText}: Selected "${selectedId}" is not a declared candidate. Known ids: ${candidates.map((c) => c.id).join(', ')}.`,
      );
      continue;
    }

    // The selected candidate must be a maximum over the candidates. "Other" is aggregated mass,
    // not a token, so it never wins. Equal percentages are allowed to resolve to whichever
    // candidate is declared Selected: measured values are rounded for display, and rounding can
    // tie two tokens the underlying measurement separated.
    const max = Math.max(...probabilities);
    if (probabilities[selectedIndex] !== max) {
      const argmax = probabilities.findIndex((p) => p === max);
      fail(
        row.line,
        `Alpha ${alphaText}: Selected is "${selectedId}" (${probabilities[selectedIndex]}%) but the highest candidate is "${candidates[argmax].id}" (${max}%).`,
      );
      continue;
    }

    const stopped = cell('stopped').toLowerCase();
    if (stopped !== 'end' && stopped !== 'limit') {
      fail(
        row.line,
        `Alpha ${alphaText}: Stopped is ${JSON.stringify(stopped)}; expected "end" (the model finished) or "limit" (it was cut off).`,
      );
      continue;
    }

    const continuation = cell('continuation');
    if (continuation === '') {
      fail(row.line, `Alpha ${alphaText}: Continuation is empty.`);
      continue;
    }
    const token = candidates[selectedIndex].token;
    if (!continuationStartsWithToken(continuation, token)) {
      fail(
        row.line,
        `Alpha ${alphaText}: Continuation must begin with the selected token ${JSON.stringify(token.replace(/^\s+/, ''))} but begins with ${JSON.stringify(continuation.slice(0, 24))}.`,
      );
      continue;
    }

    if (other > max) {
      warnings.push({
        line: row.line,
        scenario: id,
        message: `Alpha ${alphaText}: "Other" (${other}%) exceeds the largest shown candidate (${max}%), which makes the chart read oddly.`,
      });
    }

    seenIndex.set(index, row.line);
    states.push({
      index,
      alpha: ALPHA_STATES[index],
      probabilities,
      other,
      selectedId,
      selectedIndex,
      continuation,
      truncated: stopped === 'limit',
    });
  }

  const missing = ALPHA_STATES.filter((_, i) => !seenIndex.has(i));
  if (missing.length > 0) {
    fail(table.headerLine, `Missing steering state${missing.length === 1 ? '' : 's'} for alpha ${missing.join(', ')}.`);
  }
  if (errors.length > before) return null;

  states.sort((a, b) => a.index - b.index);
  return states;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseScenariosOrThrow(
  source: string,
  sourceName = 'scenarios.md',
): { set: ScenarioSet; warnings: ContentIssue[] } {
  const { set, errors, warnings } = parseScenarios(source);
  if (!set) throw new ScenarioContentError(errors, sourceName);
  return { set, warnings };
}
