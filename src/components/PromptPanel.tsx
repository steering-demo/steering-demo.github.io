export interface PromptPanelProps {
  prompt: string;
  prefix: string;
  /** Null when no live Space is configured: the fields are then read-only, as before. */
  onChange: ((next: { prompt: string; prefix: string }) => void) | null;
  edited: boolean;
  maxPrompt: number;
  maxPrefix: number;
}

/**
 * The fixed halves of the input.
 *
 * With a live Space configured these become editable, because the whole point of the page is that
 * the prompt does not change while alpha does - so letting a visitor choose the prompt, then hold
 * it fixed themselves, is the same demonstration on their own material.
 */
export function PromptPanel({ prompt, prefix, onChange, edited, maxPrompt, maxPrefix }: PromptPanelProps) {
  const editable = onChange !== null;
  const label = editable
    ? edited
      ? '(yours)'
      : '(edit to try your own)'
    : '(fixed)';

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
            <label htmlFor="scenario-prompt">
              Prompt <span className="font-normal normal-case tracking-normal">{label}</span>
            </label>
          </h2>
          {editable ? (
            <textarea
              id="scenario-prompt"
              value={prompt}
              maxLength={maxPrompt}
              rows={2}
              onChange={(event) => onChange({ prompt: event.target.value, prefix })}
              className="mt-2 w-full resize-y rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-2 text-[15px] leading-relaxed text-[var(--color-ink-2)] outline-none focus:border-[var(--color-line-strong)] focus:text-[var(--color-ink)]"
            />
          ) : (
            <p className="mt-2 text-[15px] text-[var(--color-ink-2)]">{prompt}</p>
          )}
        </div>

        <div className="border-t border-[var(--color-line)] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
            <label htmlFor="scenario-prefix">
              Response starts with{' '}
              <span className="font-normal normal-case tracking-normal">{label}</span>
            </label>
          </h2>
          {editable ? (
            <>
              <input
                id="scenario-prefix"
                value={prefix}
                maxLength={maxPrefix}
                onChange={(event) => onChange({ prompt, prefix: event.target.value })}
                className="mt-2 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-2 font-mono text-[15px] text-[var(--color-ink-2)] outline-none focus:border-[var(--color-line-strong)] focus:text-[var(--color-ink)]"
              />
              <p className="mt-1.5 text-[12px] leading-snug text-[var(--color-ink-3)]">
                These opening words are held fixed so the same next-token position can be compared
                across steering strengths. A prefix that stops just before a descriptive word
                usually shows the effect most clearly.
              </p>
            </>
          ) : (
            <p className="mt-2 font-mono text-[15px] text-[var(--color-ink-2)]">
              {prefix}
              <span aria-hidden="true" className="text-[var(--color-line-strong)]"> &#9646;</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
