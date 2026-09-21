import { describeAge, resultOrigin, type ResultIdentity } from '../lib/result';
import { modelLabel } from '../lib/models';

export type LiveState = 'idle' | 'running' | 'live' | 'error';

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
 * replaying stored results, which is the one thing a page like this cannot afford to get wrong -
 * and a second audit found the same slippage one level down, with a result replayed from the
 * Space's cache still described as computed during this visit.
 */
export function ResultBadge({ identity, stale, state }: ResultBadgeProps) {
  const origin = resultOrigin(identity);
  const live = origin !== 'recorded';
  const model = modelLabel(identity.model);
  const age = identity.ageSeconds === undefined ? undefined : describeAge(identity.ageSeconds);

  const source =
    origin === 'recorded'
      ? 'Precomputed results · no live inference'
      : origin === 'fresh'
        ? 'Computed on Hugging Face'
        : origin === 'cached'
          ? `Replayed from the Space's cache${age ? `, ${age}` : ''}`
          : `Live run failed: stored result${age ? ` from ${age}` : ''}`;

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
            origin === 'fresh' ? 'bg-[var(--color-token-pos)]' : 'bg-[var(--color-ink-3)]'
          }`}
        />
        <span>
          {source}
          {' · '}
          <span className="font-mono">{model}</span>
          {identity.layer === undefined ? null : (
            <>
              {' · '}layer {identity.layer}
              {identity.coefficient === undefined ? null : <> &middot; c&nbsp;=&nbsp;{identity.coefficient}</>}
            </>
          )}
        </span>
      </span>

      {stale && state !== 'running' && (
        <span className="pill-enter inline-flex items-center gap-2 rounded-full border border-[var(--color-token-pos)] bg-[var(--color-surface-2)] px-3 py-1 text-[var(--color-ink)]">
          {/*
            What is on screen depends on where it came from. Hardcoding "the saved example" put a
            flat contradiction in one row - "Computed on Hugging Face" beside "Showing the saved
            example" - whenever a visitor edited the prompt after a live run.
          */}
          {origin === 'recorded'
            ? 'Showing the saved example. Run your edited prompt to update these results.'
            : 'Showing an earlier measurement of different text. Run your edited prompt to update these results.'}
        </span>
      )}
    </div>
  );
}
