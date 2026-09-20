import type { Provenance } from '../lib/types';
import { LIVE_MODELS, modelLabel } from '../lib/models';

export type LiveState = 'idle' | 'running' | 'live' | 'error';

/** Plain-English age, so a stored result never pretends to be a fresh one. */
function describeAge(seconds: number): string {
  if (seconds < 90) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
}

export interface LiveControlsProps {
  provenance?: Provenance;
  /** False when no Space is configured: the page then shows recorded numbers only. */
  available: boolean;
  state: LiveState;
  model: string;
  onModelChange: (model: string) => void;
  liveModel?: string;
  cached: boolean;
  ageSeconds: number;
  error?: string;
  /** The visitor has changed the prompt or prefix, so only a live run can answer it. */
  edited: boolean;
  layer?: number;
  coefficient?: number;
  onRun: () => void;
  onRevert?: () => void;
}

/**
 * Says where the numbers came from, and offers to compute new ones.
 *
 * A live run is deliberately opt-in. Firing one on every page load spent the visitor's ZeroGPU
 * allowance to re-derive numbers the page already ships, and turned an ordinary quota limit into
 * an error message on a page that was working perfectly well.
 */
export function LiveControls({
  provenance,
  available,
  state,
  model,
  onModelChange,
  liveModel,
  cached,
  ageSeconds,
  error,
  edited,
  layer,
  coefficient,
  onRun,
  onRevert,
}: LiveControlsProps) {
  const isLive = state === 'live';
  const shown = (isLive ? liveModel : provenance?.model) ?? provenance?.model;
  const shortModel = shown ? modelLabel(shown) : 'an unpublished model';

  const settings =
    layer === undefined ? null : (
      <>
        {' '}&middot; layer {layer}
        {coefficient === undefined ? null : <> &middot; coefficient {coefficient}</>}
      </>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-1)] px-3 py-1 text-[12px] text-[var(--color-ink-2)]">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${
            isLive ? 'bg-[var(--color-token-pos)]' : 'bg-[var(--color-ink-3)]'
          }`}
        />
        <span>
          {isLive
            ? cached
              ? 'Computed on Hugging Face '
              : 'Computed live just now by '
            : 'Measured from '}
          <span className="font-mono">{shortModel}</span>
          {isLive && cached ? `, ${describeAge(ageSeconds)}` : ''}
          {settings}
        </span>
      </span>

      {available && (
        <>
          <label className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-1)] px-3 py-1 text-[12px] text-[var(--color-ink-2)]">
            <span>Model</span>
            <select
              value={model}
              onChange={(event) => onModelChange(event.target.value)}
              className="cursor-pointer rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)] outline-none"
            >
              {LIVE_MODELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} ({option.note})
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={onRun}
            disabled={state === 'running'}
            className="rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-3 py-1 text-[12px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-3)] disabled:cursor-progress disabled:opacity-70"
          >
            {state === 'running'
              ? 'Running on the GPU…'
              : edited
                ? 'Run my prompt on the GPU'
                : isLive
                  ? 'Run it again on the GPU'
                  : 'Run it live on the GPU'}
          </button>

          {(isLive || edited) && onRevert && state !== 'running' && (
            <button
              type="button"
              onClick={onRevert}
              className="text-[12px] text-[var(--color-ink-3)] underline underline-offset-2 hover:text-[var(--color-ink)]"
            >
              Back to the recorded run
            </button>
          )}
        </>
      )}

      {state === 'error' && (
        <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-1)] px-3 py-1 text-[12px] text-[var(--color-ink-3)]">
          <span className="truncate">{error ?? 'The live run did not finish.'}</span>
        </span>
      )}

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {state === 'running'
          ? 'Running the model live on Hugging Face.'
          : state === 'live'
            ? cached
              ? `Showing results computed by ${shortModel} ${describeAge(ageSeconds)}.`
              : `Showing results computed live by ${shortModel}.`
            : state === 'error'
              ? `The live run did not finish. ${error ?? ''} The recorded measurement is still shown.`
              : ''}
      </p>
    </div>
  );
}
