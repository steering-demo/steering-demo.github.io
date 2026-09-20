/**
 * The identity of a displayed result.
 *
 * Everything on screen - the chart, the completion, the without-steering reference, the layer and
 * coefficient in the badge - has to come from one record. An audit found the model dropdown
 * changing the badge while the numbers underneath stayed put, which implied a comparison that was
 * never made. Carrying identity explicitly makes that class of mistake hard to write.
 */
import type { Scenario } from './types';

export interface ResultIdentity {
  /** 'recorded' ships with the page; 'live' was computed by the Space during this visit. */
  source: 'recorded' | 'live';
  /** Hugging Face model id the numbers came from. */
  model: string;
  /** Pinned revision, when the producer recorded one. */
  revision?: string;
  scenarioId: string;
  /** The prompt actually measured, which may differ from what is in the editor right now. */
  prompt: string;
  prefix: string;
  /** Scenario whose contrast examples defined the steering direction. */
  direction: string;
  layer?: number;
  coefficient?: number;
  /** Set for a live result: how old the Space's copy was, in seconds. */
  ageSeconds?: number;
  cached?: boolean;
  /**
   * The Space served a stored result because the fresh run failed. Still a real measurement, but
   * the run the visitor asked for did not happen. Kept separate from `cached`, which is an
   * ordinary hit on a result that was computed normally.
   */
  staleCache?: boolean;
  /** Why the fresh run failed, when `staleCache` is set. */
  cacheNote?: string;
  /** ISO date a recorded measurement was taken. Absent for live results, which carry an age. */
  measured?: string;
}

/** How a displayed result was produced. Drives every provenance sentence on the page. */
export type ResultOrigin = 'recorded' | 'fresh' | 'cached' | 'stale';

/**
 * Which of the four origins a result has.
 *
 * "Live" is not one fact but three: the Space ran the model just now, the Space replayed a
 * result it computed earlier, or the Space could not run at all and fell back to a stored one.
 * An audit found all three described as "computed during this visit".
 */
export function resultOrigin(identity: ResultIdentity): ResultOrigin {
  if (identity.source === 'recorded') return 'recorded';
  if (identity.staleCache) return 'stale';
  return identity.cached ? 'cached' : 'fresh';
}

export interface DisplayedResult {
  scenario: Scenario;
  identity: ResultIdentity;
}

/** A stable key for one measurable configuration. Late replies for other keys are discarded. */
export function identityKey(identity: ResultIdentity): string {
  return [
    identity.source,
    identity.model,
    identity.scenarioId,
    identity.direction,
    identity.prompt,
    identity.prefix,
  ].join('\u0000');
}

/**
  * True when the editor no longer matches what produced the result on screen.
  *
  * Whitespace is collapsed on both sides because the Space collapses it too. Without that, a
  * trailing space in the editor would make a result the Space had just measured for that exact
  * prompt report itself as stale.
  */
export function isStale(identity: ResultIdentity, prompt: string, prefix: string): boolean {
  const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
  return collapse(identity.prompt) !== collapse(prompt) || collapse(identity.prefix) !== collapse(prefix);
}

export function recordedIdentity(
  scenario: Scenario,
  model: string,
  revision?: string,
  measured?: string,
): ResultIdentity {
  return {
    source: 'recorded',
    model,
    revision,
    measured,
    scenarioId: scenario.id,
    prompt: scenario.prompt,
    prefix: scenario.prefix,
    direction: scenario.id,
    layer: scenario.layer,
    coefficient: scenario.coefficient,
  };
}

/**
 * A probability for display.
 *
 * Percentages are stored at six significant figures, so a token the model gave almost nothing to
 * arrives here as a real number rather than as zero. Exact zero and "too small to write at one
 * decimal" are different statements and the page makes them differently.
 */
export function formatPercent(value: number): string {
  if (value === 0) return '0%';
  if (value < 0.1) return '<0.1%';
  return `${value.toFixed(1)}%`;
}

/** The same value for a screen reader, which should not have to interpret "<". */
export function spokenPercent(value: number): string {
  if (value === 0) return '0 percent';
  if (value < 0.1) return 'less than 0.1 percent';
  return `${value.toFixed(1)} percent`;
}

/** A cached result's age, in words. Shared by the badge and the explanation so they agree. */
export function describeAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 90) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
}

/** A pinned revision, shortened the way a commit is usually written. */
export function shortRevision(revision?: string): string | undefined {
  if (!revision || revision === 'main') return revision === 'main' ? 'main' : undefined;
  return /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 10) : revision;
}
