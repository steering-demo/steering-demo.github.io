/**
 * Talks to the Hugging Face Space that runs the real model.
 *
 * One request computes an entire scenario - all nine alpha states, each with the measured
 * next-token distribution and the continuation the steered model actually generated. Doing it
 * per scenario rather than per slider position means the slider stays instant and local once
 * the results land, and a visitor costs one GPU call per tab rather than one per drag.
 *
 * The page never depends on this succeeding: the bundled measurements render immediately and
 * stay on screen if the Space is asleep, out of quota, or unreachable.
 */
import { ALPHAS_KEY, type Candidate, type Scenario, type SteeringState } from './types';

/** Gradio 5 serves the API under /gradio_api; Gradio 4 serves it at the root. */
const API_PREFIXES = ['/gradio_api/call', '/call'] as const;
const FUNCTION_NAME = 'run_scenario';

export interface LiveResult {
  scenario: Scenario;
  model: string;
  device: string;
}

interface SpacePayload {
  id: string;
  title: string;
  negative_label: string;
  positive_label: string;
  prompt: string;
  prefix: string;
  takeaway: string;
  candidates: string[];
  layer: number;
  scale: number;
  model?: string;
  device?: string;
  error?: string;
  states: {
    alpha: number;
    percents: number[];
    other: number;
    selected: string;
    continuation: string;
  }[];
}

export class LiveError extends Error {}

/**
 * Which API prefix this Space answers on, remembered after the first successful call.
 *
 * A hosted Space runs Gradio 5 and answers on /gradio_api straight away. Only a Gradio 4 Space
 * costs one 404 on the very first request, and never again.
 */
let knownPrefix: string | undefined;

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Pulls the final `data:` frame out of Gradio's server-sent event stream. */
function lastDataFrame(stream: string): unknown[] {
  const frames = stream
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6));
  if (frames.length === 0) throw new LiveError('the Space returned no data');

  for (let i = frames.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(frames[i]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Heartbeat and status frames are not JSON arrays; keep looking backwards.
    }
  }
  throw new LiveError('the Space returned no result frame');
}

function toScenario(payload: SpacePayload): Scenario {
  const taken = new Set<string>();
  const candidates: Candidate[] = payload.candidates.map((token) => {
    const label = token.replace(/^\s+/, '');
    let id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'token';
    while (taken.has(id)) id = `${id}-x`;
    taken.add(id);
    return { id, token, label };
  });

  const states: SteeringState[] = payload.states.map((state, index) => {
    const selectedIndex = Math.max(0, payload.candidates.indexOf(state.selected));
    return {
      index,
      alpha: state.alpha,
      probabilities: state.percents,
      other: state.other,
      selectedId: candidates[selectedIndex].id,
      selectedIndex,
      continuation: state.continuation,
    };
  });

  return {
    id: payload.id,
    title: payload.title,
    negativeLabel: payload.negative_label,
    positiveLabel: payload.positive_label,
    prompt: payload.prompt,
    prefix: payload.prefix,
    takeaway: payload.takeaway,
    candidates,
    states,
    layer: payload.layer,
    coefficient: payload.scale,
  };
}

/** Validates the shape we depend on before letting it anywhere near the UI. */
function assertUsable(payload: SpacePayload): void {
  if (payload.error) throw new LiveError(payload.error);
  if (!Array.isArray(payload.candidates) || payload.candidates.length < 2) {
    throw new LiveError('the Space returned no candidate tokens');
  }
  if (!Array.isArray(payload.states) || payload.states.length !== ALPHAS_KEY.length) {
    throw new LiveError(`expected ${ALPHAS_KEY.length} steering states`);
  }
  for (const state of payload.states) {
    if (state.percents.length !== payload.candidates.length) {
      throw new LiveError('a state does not line up with the candidate tokens');
    }
    if (!Number.isFinite(state.other) || typeof state.continuation !== 'string') {
      throw new LiveError('a state is missing its numbers or its continuation');
    }
  }
}

async function callOnce(
  base: string,
  prefix: string,
  scenarioId: string,
  signal: AbortSignal,
): Promise<SpacePayload> {
  const endpoint = `${base}${prefix}/${FUNCTION_NAME}`;

  const started = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: [scenarioId] }),
    signal,
  });
  if (!started.ok) throw new LiveError(`the Space replied ${started.status}`);

  const { event_id: eventId } = (await started.json()) as { event_id?: string };
  if (!eventId) throw new LiveError('the Space did not start a job');

  const stream = await fetch(`${endpoint}/${eventId}`, { signal });
  if (!stream.ok) throw new LiveError(`the Space replied ${stream.status} while streaming`);

  const frame = lastDataFrame(await stream.text());
  const raw = frame[0];
  if (typeof raw !== 'string') throw new LiveError('the Space returned an unexpected result');
  return JSON.parse(raw) as SpacePayload;
}

/**
 * Runs one scenario on the Space.
 *
 * `timeoutMs` is generous because a free Space sleeps when idle and the first call after that
 * has to start the container and load the model.
 */
export async function runLiveScenario(
  spaceUrl: string,
  scenarioId: string,
  { signal, timeoutMs = 120_000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<LiveResult> {
  const base = normalizeBase(spaceUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    let lastError: unknown;
    const order = knownPrefix
      ? [knownPrefix, ...API_PREFIXES.filter((p) => p !== knownPrefix)]
      : [...API_PREFIXES];
    for (const prefix of order) {
      try {
        const payload = await callOnce(base, prefix, scenarioId, controller.signal);
        assertUsable(payload);
        knownPrefix = prefix;
        return {
          scenario: toScenario(payload),
          model: payload.model ?? 'unknown model',
          device: payload.device ?? '',
        };
      } catch (error) {
        // A 404 just means this Gradio version serves the API at the other path.
        lastError = error;
        if (controller.signal.aborted) break;
      }
    }
    throw lastError instanceof Error ? lastError : new LiveError('the Space could not be reached');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
