import { ALPHA_STATES, NEUTRAL_INDEX, alphaToIndex, formatAlpha } from '../lib/types';

export interface AlphaSliderProps {
  stateIndex: number;
  onChange: (index: number) => void;
  negativeLabel: string;
  positiveLabel: string;
  /** Full sentence read by screen readers at the current position. */
  valueText: string;
  scenarioTitle: string;
}

const PRESETS = [0, NEUTRAL_INDEX, ALPHA_STATES.length - 1];

export function AlphaSlider({
  stateIndex,
  onChange,
  negativeLabel,
  positiveLabel,
  valueText,
  scenarioTitle,
}: AlphaSliderProps) {
  const alpha = ALPHA_STATES[stateIndex];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <label htmlFor="alpha-slider" className="text-sm font-medium text-[var(--color-ink-2)]">
          Steering strength{' '}
          <span className="font-mono text-base not-italic text-[var(--color-ink)]">&alpha;</span>
        </label>
        <output
          htmlFor="alpha-slider"
          className="font-mono text-2xl leading-none tabular-nums text-[var(--color-ink)]"
        >
          {formatAlpha(alpha)}
        </output>
      </div>

      <div className="mt-3">
        <input
          id="alpha-slider"
          className="alpha-range"
          type="range"
          min={-2}
          max={2}
          step={0.5}
          value={alpha}
          aria-valuetext={valueText}
          aria-describedby="alpha-slider-hint"
          onChange={(event) => {
            const next = alphaToIndex(Number(event.target.value));
            if (next !== -1) onChange(next);
          }}
        />

        {/* Nine tick marks matching the nine discrete states. */}
        <div aria-hidden="true" className="mt-[-6px] flex justify-between px-[11px]">
          {ALPHA_STATES.map((value, index) => (
            <span
              key={value}
              className="block w-px"
              style={{
                height: index === NEUTRAL_INDEX ? 10 : index % 2 === 0 ? 7 : 4,
                background: index === stateIndex ? 'var(--color-ink-2)' : 'var(--color-line-strong)',
              }}
            />
          ))}
        </div>

        {/*
          The endpoint labels are the jump targets. A separate "Jump to" row repeated the same
          three values directly beneath labels that already named them, and cost a row of the
          first viewport for it. The middle one hides on the narrowest screens, where the slider
          and the Reset button both reach alpha 0.
        */}
        <div className="mt-1 flex items-start justify-between gap-3 text-[12px] leading-tight">
          {PRESETS.map((index) => {
            const value = ALPHA_STATES[index];
            const meaning = value < 0 ? negativeLabel : value > 0 ? positiveLabel : 'no steering';
            const current = index === stateIndex;
            return (
              <button
                key={index}
                type="button"
                onClick={() => onChange(index)}
                aria-label={`Set alpha to ${value < 0 ? 'minus ' : value > 0 ? 'plus ' : ''}${Math.abs(value).toFixed(1)}, ${meaning}`}
                className={`pressable -mx-1 max-w-[11rem] rounded px-1 py-1 ${
                  value === 0 ? 'hidden text-center sm:block' : value < 0 ? 'text-left' : 'text-right'
                } ${
                  current
                    ? 'text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
                }`}
              >
                <span className="font-mono">{formatAlpha(value)}</span> &middot; {meaning}
              </button>
            );
          })}
        </div>
      </div>

      <p id="alpha-slider-hint" className="sr-only">
        Nine discrete steps from minus 2 to plus 2 for the {scenarioTitle} scenario. Use the arrow
        keys to move one step, Home and End for the extremes. The labels under the slider jump
        straight to their positions.
      </p>
    </div>
  );
}
