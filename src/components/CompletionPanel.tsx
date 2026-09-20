import { formatPercent } from '../lib/result';

export interface CompletionPanelProps {
  prefix: string;
  continuation: string;
  /** Selected token without its leading space. */
  tokenLabel: string;
  color: string;
  probability: number;
}

/**
 * The generated continuation.
 *
 * The fixed prefix stays visually muted so the eye lands on what actually changed, and the
 * selected first token wears a tinted chip in its chart colour - the colour lives in the chip,
 * not the glyphs, so the text keeps its normal contrast.
 */
export function CompletionPanel({
  prefix,
  continuation,
  tokenLabel,
  color,
  probability,
}: CompletionPanelProps) {
  // Slice from the continuation itself so the author's capitalisation is preserved.
  const head = continuation.slice(0, tokenLabel.length);
  const tail = continuation.slice(tokenLabel.length);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
          Model response
        </h3>
        <p className="text-[12px] text-[var(--color-ink-3)]">
          Next token:{' '}
          <span
            className="rounded px-1 font-mono text-[var(--color-ink)]"
            style={{ background: `color-mix(in oklab, ${color} 26%, transparent)` }}
          >
            {head}
          </span>{' '}
          <span className="tabular-nums">&middot; {formatPercent(probability)}</span>
        </p>
      </div>

      {/*
        A generous minimum height keeps the panel from resizing as completions of different
        lengths swap in, which would otherwise shift the chart below it on every drag.
      */}
      {/* Top-aligned with a reserved height: enough that a long and a short response do not
          move the chart below, without a band of empty space above a short one. */}
      <div className="mt-3 min-h-[10rem] sm:min-h-[8.5rem] lg:min-h-[9rem]">
        <p className="text-[17px] leading-relaxed">
          <span className="text-[var(--color-ink-3)]">{prefix} </span>
          <span
            className="rounded-sm px-0.5 font-medium text-[var(--color-ink)]"
            style={{
              background: `color-mix(in oklab, ${color} 26%, transparent)`,
              boxShadow: `inset 0 -2px 0 ${color}`,
            }}
          >
            {head}
          </span>
          <span className="text-[var(--color-ink)]">{tail}</span>
        </p>
      </div>
    </div>
  );
}
