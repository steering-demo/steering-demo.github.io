/**
 * Types shared by the build-time content parser and the UI.
 *
 * The showcase renders authored toy data only. Nothing here is a model measurement.
 */

/** The nine discrete steering states, ascending. Index into this array is the UI state. */
export const ALPHA_STATES = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2] as const;

/** The alpha grid as a plain array, for length checks against data arriving from the Space. */
export const ALPHAS_KEY: readonly number[] = ALPHA_STATES;

/** Index of the neutral (alpha = 0) state. Used for reset and the neutral reference. */
export const NEUTRAL_INDEX = 4;

/** Percentages in one state are allowed to miss 100 by at most this much. */
export const SUM_TOLERANCE = 0.5;

export interface Candidate {
  /** Stable key used by the probability-table columns and the `Selected` cell. */
  id: string;
  /** Token text verbatim from the source, including its leading space. */
  token: string;
  /** Token without the leading space — what is shown in the chart and the completion. */
  label: string;
}

export interface SteeringState {
  /** 0-8. Authoritative for lookups; alpha is derived for display. */
  index: number;
  /** -2 .. 2 in steps of 0.5. */
  alpha: number;
  /** Percentages aligned to `Scenario.candidates` order. */
  probabilities: number[];
  /** Aggregated remaining probability mass. Not a token. */
  other: number;
  /** Candidate id with the highest individual probability in this state. */
  selectedId: string;
  /** Index of `selectedId` within `Scenario.candidates`. */
  selectedIndex: number;
  /** The model's own continuation, beginning with the selected candidate's label. */
  continuation: string;
  /** True when generation stopped at the token limit rather than finishing. */
  truncated: boolean;
}

/** Where the numbers came from. Absent when the content is authored rather than measured. */
export interface Provenance {
  /** Hugging Face model id the measurements were taken from. */
  model: string;
  /** Pinned commit of those weights. A model id without a revision is only half an answer. */
  revision?: string;
  /** One sentence describing the intervention. */
  method: string;
  /** ISO date of the measurement run. */
  measured: string;
}

export interface Scenario {
  id: string;
  title: string;
  /** Endpoint label shown at alpha = -2. */
  negativeLabel: string;
  /** Endpoint label shown at alpha = +2. */
  positiveLabel: string;
  prompt: string;
  /** Fixed response prefix; never changes with alpha. */
  prefix: string;
  takeaway: string;
  candidates: Candidate[];
  /** Exactly nine states, ordered by ascending alpha. */
  states: SteeringState[];
  /** Decoder layer the steering vector was added at, when measured. */
  layer?: number;
  /** Multiplier applied to the steering vector, when measured. */
  coefficient?: number;
}

export interface ScenarioSet {
  scenarios: Scenario[];
  provenance?: Provenance;
}

/** Index on the alpha grid, or -1 when the value is off-grid. Shared by the parser and the UI. */
export function alphaToIndex(alpha: number): number {
  if (!Number.isFinite(alpha)) return -1;
  const index = Math.round((alpha + 2) / 0.5);
  if (index < 0 || index >= ALPHA_STATES.length) return -1;
  return Math.abs(ALPHA_STATES[index] - alpha) < 1e-9 ? index : -1;
}

/** Formats an alpha value the same way everywhere: -2.0, -1.5, 0.0, +1.5, +2.0. */
export function formatAlpha(alpha: number): string {
  const sign = alpha > 0 ? '+' : alpha < 0 ? '−' : '';
  return `${sign}${Math.abs(alpha).toFixed(1)}`;
}

/** Direction label for a scenario, e.g. "Negative sentiment to Positive sentiment". */
export function directionLabel(scenario: Pick<Scenario, 'negativeLabel' | 'positiveLabel'>): string {
  return `${scenario.negativeLabel} ↔ ${scenario.positiveLabel}`;
}
