import type { Provenance } from '../lib/types';

export type LiveStatus = 'off' | 'loading' | 'live' | 'error';

export interface LiveStatusBarProps {
  provenance?: Provenance;
  status: LiveStatus;
  liveModel?: string;
  error?: string;
  layer?: number;
  coefficient?: number;
  onRetry?: () => void;
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
  onRetry,
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
      {status === 'live' ? (
        <Pill tone="active">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-token-pos)]" />
          Computed live just now by <span className="font-mono">{shortModel}</span>
          {settings}
        </Pill>
      ) : (
        <Pill>
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-ink-3)]" />
          {provenance ? (
            <>
              Measured from <span className="font-mono">{shortModel}</span>
              {settings}
            </>
          ) : (
            <>Illustrative data &middot; no model</>
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
