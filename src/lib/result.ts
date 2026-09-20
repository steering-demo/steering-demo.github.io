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

/** True when the editor no longer matches what produced the result on screen. */
export function isStale(identity: ResultIdentity, prompt: string, prefix: string): boolean {
  return identity.prompt !== prompt || identity.prefix !== prefix;
}

export function recordedIdentity(scenario: Scenario, model: string, revision?: string): ResultIdentity {
  return {
    source: 'recorded',
    model,
    revision,
    scenarioId: scenario.id,
    prompt: scenario.prompt,
    prefix: scenario.prefix,
    direction: scenario.id,
    layer: scenario.layer,
    coefficient: scenario.coefficient,
  };
}

/** Percentages are stored at two decimals so a small real value is not shown as zero. */
export function formatPercent(value: number): string {
  if (value === 0) return '0%';
  if (value < 0.1) return '<0.1%';
  return `${value.toFixed(1)}%`;
}
