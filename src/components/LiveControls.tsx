import { LIVE_MODELS } from '../lib/models';
import type { LiveState } from './ResultBadge';

export interface LiveControlsProps {
  state: LiveState;
  /** Model the NEXT live run will use. It does not describe what is on screen. */
  model: string;
  onModelChange: (model: string) => void;
  error?: string;
  edited: boolean;
  onRun: () => void;
  onRevert?: () => void;
  showRevert: boolean;
}

/**
 * Controls for an optional live run.
 *
 * The model selector is deliberately labelled for the run it configures, not for the result on
 * screen. Presented as a plain "Model" next to a provenance badge it read as a comparison
 * control, and changing it appeared to leave the numbers unchanged.
 */
export function LiveControls({
  state,
  model,
  onModelChange,
  error,
  edited,
  onRun,
  onRevert,
  showRevert,
}: LiveControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <label className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-1)] px-3 py-1 text-[var(--color-ink-2)]">
        <span>Model for live run</span>
        <select
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          className="cursor-pointer rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)] outline-none"
        >
          {LIVE_MODELS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={onRun}
        disabled={state === 'running'}
        className="pressable rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-3 py-1 text-[var(--color-ink)] hover:bg-[var(--color-surface-3)] disabled:cursor-progress disabled:opacity-70"
      >
        {state === 'running'
          ? 'Running on the GPU\u2026'
          : edited
            ? 'Run my prompt on the GPU'
            : 'Run this example on the GPU'}
      </button>

      {showRevert && state !== 'running' && onRevert && (
        <button
          type="button"
          onClick={onRevert}
          className="pill-enter text-[var(--color-ink-3)] underline underline-offset-2 transition-colors hover:text-[var(--color-ink)]"
        >
          Back to the saved example
        </button>
      )}

      {state === 'error' && (
        <span className="pill-enter inline-flex max-w-full items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-1)] px-3 py-1 text-[var(--color-ink-3)]">
          <span className="truncate">
            Live run did not finish{error ? `: ${error}` : ''}. The saved results are unchanged.
          </span>
        </span>
      )}

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {state === 'running'
          ? 'Running the model on Hugging Face.'
          : state === 'error'
            ? 'The live run did not finish. The saved results are unchanged.'
            : ''}
      </p>
    </div>
  );
}
