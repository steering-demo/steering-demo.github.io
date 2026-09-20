import type { Provenance } from '../lib/types';

export type LiveStatus = 'off' | 'loading' | 'live' | 'error';

/** Plain-English age, so a stored result never pretends to be a fresh one. */
function describeAge(seconds: number): string {
  if (seconds < 90) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
}

export interface LiveStatusBarProps {
  provenance?: Provenance;
  status: LiveStatus;
  liveModel?: string;
  error?: string;
  layer?: number;
  coefficient?: number;
  /** The Space served a stored result rather than running the model again. */
  cached?: boolean;
  ageSeconds?: number;
  onRetry?: () => void;
  /** Spend GPU time on a real run, ignoring the Space's cache. */
  onRecompute?: () => void;
}

function Pill({ children, tone = 'quiet' }: { children: React.ReactNode; tone?: 'quiet' | 'active' }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] ${
        tone === 'active'
          ? 'border-[var(--color-line-strong)] bg-[var(--color-surface-2)] text-[var(--color-ink)]'
          : 'border-[var(--color-line)] bg-[var(--color-surface-1)] text-[var(--color-ink-2)]'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Says exactly where the numbers on screen came from.
 *
 * Three honest states: the bundled measurement, a live run in progress, and a live result. The
 * bundled numbers are real measurements too, so nothing here ever has to claim more than it can.
 */
export function LiveStatusBar({
  provenance,
  status,
  liveModel,
  error,
  layer,
  coefficient,
  cached = false,
  ageSeconds = 0,
  onRetry,
  onRecompute,
}: LiveStatusBarProps) {
  const model = (status === 'live' ? liveModel : provenance?.model) ?? provenance?.model;
  const shortModel = model?.split('/').pop() ?? 'an unpublished model';
  const settings =
    layer === undefined ? null : (
      <>
        {' '}&middot; layer {layer}
        {coefficient === undefined ? null : <> &middot; coefficient {coefficient}</>}
      </>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/*
        The pill is a flex row, so every fragment inside it becomes a flex item and picks up the
        gap. All of the prose therefore lives in one child, or punctuation drifts away from the
        word it belongs to.
      */}
      {status === 'live' ? (
        <Pill tone="active">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-token-pos)]" />
          <span>
            {cached ? 'Computed on Hugging Face ' : 'Computed live just now by '}
            <span className="font-mono">{shortModel}</span>
            {cached ? `, ${describeAge(ageSeconds)}` : ''}
            {settings}
          </span>
        </Pill>
      ) : (
        <Pill>
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-ink-3)]" />
          {provenance ? (
            <span>
              Measured from <span className="font-mono">{shortModel}</span>
              {settings}
            </span>
          ) : (
            <span>Illustrative data &middot; no model</span>
          )}
        </Pill>
      )}

      {status === 'loading' && (
        <Pill>
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--color-token-neg)]"
          />
          Running it live on Hugging Face&hellip;
        </Pill>
      )}

      {status === 'live' && cached && onRecompute && (
        <Pill>
          <button
            type="button"
            onClick={onRecompute}
            className="underline underline-offset-2 hover:text-[var(--color-ink)]"
          >
            Run it again on the GPU
          </button>
        </Pill>
      )}

      {status === 'error' && (
        <Pill>
          <span className="text-[var(--color-ink-3)]">
            Live run unavailable &mdash; showing the recorded measurement
            {error ? <span className="sr-only"> ({error})</span> : null}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="underline underline-offset-2 hover:text-[var(--color-ink)]"
            >
              Retry
            </button>
          )}
        </Pill>
      )}

      <p aria-live="polite" className="sr-only">
        {status === 'loading'
          ? 'Running the model live on Hugging Face.'
          : status === 'live'
            ? `Showing results computed live by ${shortModel}.`
            : status === 'error'
              ? 'The live run was unavailable. Showing the recorded measurement instead.'
              : ''}
      </p>
    </div>
  );
}
