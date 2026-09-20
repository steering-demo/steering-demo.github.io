import type { ResultIdentity } from '../lib/result';
import { modelLabel } from '../lib/models';

export type LiveState = 'idle' | 'running' | 'live' | 'error';

function describeAge(seconds: number): string {
  if (seconds < 90) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
}

export interface ResultBadgeProps {
  identity: ResultIdentity;
  /** The editor no longer matches what produced these results. */
  stale: boolean;
  state: LiveState;
}

/**
 * States, in one place, exactly where the numbers on screen came from.
 *
 * Precomputed is named first and plainly. An audit found the page implying live computation while
 * replaying stored results, which is the one thing a page like this cannot afford to get wrong.
 */
export function ResultBadge({ identity, stale, state }: ResultBadgeProps) {
  const live = identity.source === 'live';
  const model = modelLabel(identity.model);

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${
          live
            ? 'border-[var(--color-line-strong)] bg-[var(--color-surface-2)] text-[var(--color-ink)]'
            : 'border-[var(--color-line)] bg-[var(--color-surface-1)] text-[var(--color-ink-2)]'
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${
            live ? 'bg-[var(--color-token-pos)]' : 'bg-[var(--color-ink-3)]'
          }`}
        />
        <span>
          {live ? 'Computed on Hugging Face' : 'Precomputed results · no live inference'}
          {' · '}
          <span className="font-mono">{model}</span>
          {live && identity.cached && identity.ageSeconds !== undefined
            ? `, ${describeAge(identity.ageSeconds)}`
            : ''}
          {identity.layer === undefined ? null : (
            <>
              {' · '}layer {identity.layer}
              {identity.coefficient === undefined ? null : <> &middot; c&nbsp;=&nbsp;{identity.coefficient}</>}
            </>
          )}
        </span>
      </span>

      {stale && state !== 'running' && (
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-token-pos)] bg-[var(--color-surface-2)] px-3 py-1 text-[var(--color-ink)]">
          Showing the saved example. Run your edited prompt to update these results.
        </span>
      )}
    </div>
  );
}
