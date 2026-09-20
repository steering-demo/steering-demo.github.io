import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useAnimatedNumbers, useDebounced, usePrefersReducedMotion } from '../lib/hooks';
import { TOKEN_OTHER, candidateColor } from '../lib/palette';
import { runLiveScenario } from '../lib/live';
import { NEUTRAL_INDEX, formatAlpha, type Provenance, type Scenario } from '../lib/types';
import { AlphaSlider } from './AlphaSlider';
import { CompletionPanel } from './CompletionPanel';
import { HowItWorks } from './HowItWorks';
import { LiveStatusBar, type LiveStatus } from './LiveStatus';
import { ScenarioTabs } from './ScenarioTabs';
import { SchematicSpace } from './SchematicSpace';
import { TokenChart, type ChartRow } from './TokenChart';

const ANIMATION_MS = 200;
const ANNOUNCE_DELAY_MS = 500;

/** Alpha written for a screen reader, which should not have to interpret a minus glyph. */
function spokenAlpha(alpha: number): string {
  if (alpha === 0) return 'alpha 0.0, no steering';
  return `alpha ${alpha < 0 ? 'minus' : 'plus'} ${Math.abs(alpha).toFixed(1)}`;
}

export interface SteeringShowcaseProps {
  scenarios: Scenario[];
  provenance?: Provenance;
  /** Hugging Face Space that runs the model. Omitted, the page stays on the recorded data. */
  spaceUrl?: string;
}

export function SteeringShowcase({ scenarios, provenance, spaceUrl }: SteeringShowcaseProps) {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [stateIndex, setStateIndex] = useState(NEUTRAL_INDEX);
  const [live, setLive] = useState<Record<string, Scenario>>({});
  const [liveModel, setLiveModel] = useState<string>();
  const [liveCached, setLiveCached] = useState(false);
  const [liveAge, setLiveAge] = useState(0);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(spaceUrl ? 'loading' : 'off');
  const [liveError, setLiveError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [forceFresh, setForceFresh] = useState(false);
  const panelId = useId();

  const recorded = useMemo(
    () => scenarios.find((item) => item.id === scenarioId) ?? scenarios[0],
    [scenarios, scenarioId],
  );
  // The recorded measurement is always on screen; a live result replaces it when one arrives.
  const scenario = live[recorded.id] ?? recorded;

  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!spaceUrl) return;
    // `?live=0` keeps the page on the recorded measurements - handy for a slow connection, and
    // what the browser tests use to stay deterministic.
    if (new URLSearchParams(window.location.search).get('live') === '0') {
      setLiveStatus('off');
      return;
    }
    if (live[recorded.id]) {
      setLiveStatus('live');
      return;
    }

    const controller = new AbortController();
    inFlight.current?.abort();
    inFlight.current = controller;
    setLiveStatus('loading');
    setLiveError(undefined);

    runLiveScenario(spaceUrl, recorded.id, { signal: controller.signal, fresh: forceFresh })
      .then((result) => {
        if (controller.signal.aborted) return;
        setLive((current) => ({ ...current, [recorded.id]: result.scenario }));
        setLiveModel(result.model);
        setLiveCached(result.cached);
        setLiveAge(result.ageSeconds);
        setLiveStatus('live');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLiveError(error instanceof Error ? error.message : String(error));
        setLiveStatus('error');
      });

    return () => controller.abort();
    // `forceFresh` is read at call time on purpose: it must not re-trigger the effect by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceUrl, recorded.id, live, attempt]);

  const requestLive = useCallback(
    (fresh: boolean) => {
      setForceFresh(fresh);
      setLive((current) => {
        const next = { ...current };
        delete next[recorded.id];
        return next;
      });
      setAttempt((value) => value + 1);
    },
    [recorded.id],
  );
  const retryLive = useCallback(() => requestLive(false), [requestLive]);
  const recomputeLive = useCallback(() => requestLive(true), [requestLive]);

  const state = scenario.states[stateIndex] ?? scenario.states[NEUTRAL_INDEX];
  const isLive = liveStatus === 'live' && Boolean(live[recorded.id]);
  const neutral = scenario.states[NEUTRAL_INDEX];
  const candidateCount = scenario.candidates.length;
  const colors = scenario.candidates.map((_, index) => candidateColor(index, candidateCount));
  const selected = scenario.candidates[state.selectedIndex];
  const selectedColor = colors[state.selectedIndex];
  const selectedProbability = state.probabilities[state.selectedIndex];

  const reducedMotion = usePrefersReducedMotion();
  // One tween drives the bars and the schematic together, so they can never disagree mid-flight.
  const eased = useAnimatedNumbers([...state.probabilities, state.other, state.alpha], {
    duration: ANIMATION_MS,
    enabled: !reducedMotion,
    snapKey: scenario.id,
  });

  const rows: ChartRow[] = [
    ...scenario.candidates.map((candidate, index) => ({
      key: candidate.id,
      label: candidate.label,
      value: eased[index] ?? state.probabilities[index],
      displayValue: state.probabilities[index],
      neutral: neutral.probabilities[index],
      color: colors[index],
      muted: false,
    })),
    {
      key: '__other',
      label: 'Other',
      value: eased[candidateCount] ?? state.other,
      displayValue: state.other,
      neutral: neutral.other,
      color: TOKEN_OTHER,
      muted: true,
    },
  ];

  const chartSummary =
    `Next-token probabilities for ${scenario.title} at ${spokenAlpha(state.alpha)}: ` +
    `${scenario.candidates
      .map((candidate, index) => `${candidate.label} ${state.probabilities[index]} percent`)
      .join(', ')}, and ${state.other} percent for all other tokens combined.`;

  const direction =
    state.alpha === 0
      ? 'no steering applied'
      : `steering toward ${state.alpha < 0 ? scenario.negativeLabel : scenario.positiveLabel}`;

  const sliderValueText =
    `${spokenAlpha(state.alpha)} of minus 2 to plus 2. ${
      direction.charAt(0).toUpperCase() + direction.slice(1)
    }. Most likely next token: ${selected.label}, ${selectedProbability} percent.`;

  const announcement =
    `${spokenAlpha(state.alpha)}, ${direction}. ` +
    `Next token ${selected.label}, ${selectedProbability} percent. ` +
    `Completion: ${scenario.prefix} ${state.continuation}`;
  const announced = useDebounced(announcement, ANNOUNCE_DELAY_MS);

  const atNeutral = stateIndex === NEUTRAL_INDEX;

  function selectScenario(id: string) {
    setScenarioId(id);
    setStateIndex(NEUTRAL_INDEX);
  }

  return (
    <div className="min-w-0">
      <div className="mb-4">
        <LiveStatusBar
          provenance={provenance}
          status={liveStatus}
          liveModel={liveModel}
          error={liveError}
          layer={scenario.layer}
          coefficient={scenario.coefficient}
          cached={liveCached}
          ageSeconds={liveAge}
          onRetry={retryLive}
          onRecompute={recomputeLive}
        />
      </div>

      <ScenarioTabs
        scenarios={scenarios.map(({ id, title }) => ({ id, title }))}
        activeId={scenario.id}
        onSelect={selectScenario}
        panelId={panelId}
      />

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`tab-${scenario.id}`}
        className="mt-4 space-y-4"
      >
        {/* 3. The fixed halves of the input, kept visually apart from what is generated. */}
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                Prompt <span className="font-normal normal-case tracking-normal">(fixed)</span>
              </h2>
              <p className="mt-2 text-[15px] text-[var(--color-ink-2)]">{scenario.prompt}</p>
            </div>
            <div className="border-t border-[var(--color-line)] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                Response prefix{' '}
                <span className="font-normal normal-case tracking-normal">(fixed)</span>
              </h2>
              <p className="mt-2 font-mono text-[15px] text-[var(--color-ink-2)]">
                {scenario.prefix}
                <span aria-hidden="true" className="text-[var(--color-line-strong)]"> &#9646;</span>
              </p>
            </div>
          </div>
        </section>

        {/* 4. The intervention itself. */}
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-4 sm:p-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center">
            <SchematicSpace
              alpha={eased[candidateCount + 1] ?? state.alpha}
              targetAlpha={state.alpha}
              color={selectedColor}
              negativeLabel={scenario.negativeLabel}
              positiveLabel={scenario.positiveLabel}
            />
            <div>
              <p className="font-mono text-xl text-[var(--color-ink)]">
                <em className="not-italic">h&#8242;</em> = <em className="not-italic">h</em> +{' '}
                <em className="not-italic">&alpha;v</em>
              </p>
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] leading-snug">
                {[
                  ['h', 'the internal representation, unchanged'],
                  ['v', 'the steering direction, chosen in advance'],
                  ['α', 'how far to push, and which way'],
                  ['h′', 'the state the model carries on from'],
                ].map(([symbol, meaning]) => (
                  <div key={symbol} className="contents">
                    <dt className="font-mono italic text-[var(--color-ink)]">{symbol}</dt>
                    <dd className="m-0 text-[var(--color-ink-2)]">{meaning}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[13px] leading-snug text-[var(--color-ink-3)]">
                Direction for this scenario: {scenario.negativeLabel} &#8596; {scenario.positiveLabel}.
              </p>
            </div>
          </div>
        </section>

        {/* 5. The control. */}
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-4 sm:p-5">
          <AlphaSlider
            stateIndex={stateIndex}
            onChange={setStateIndex}
            negativeLabel={scenario.negativeLabel}
            positiveLabel={scenario.positiveLabel}
            valueText={sliderValueText}
            scenarioTitle={scenario.title}
          />
        </section>

        {/* 6. What changed. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-4 sm:p-5">
            <CompletionPanel
              prefix={scenario.prefix}
              continuation={state.continuation}
              tokenLabel={selected.label}
              color={selectedColor}
              probability={selectedProbability}
            />
          </section>

          <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                Next-token probability
              </h3>
              <p className="text-[12px] text-[var(--color-ink-3)]">
                one position, right after the prefix
              </p>
            </div>
            <div className="mt-3">
              <TokenChart
                key={`${scenario.id}-${isLive ? 'live' : 'recorded'}`}
                rows={rows}
                summary={chartSummary}
                alphaLabel={`alpha ${formatAlpha(state.alpha)}`}
              />
            </div>
            <p className="mt-2 text-[12px] leading-snug text-[var(--color-ink-3)]">
              <span aria-hidden="true" className="mr-1 inline-block h-[10px] w-[2px] translate-y-[1px] bg-[var(--color-ink-2)]" />
              Marker: where this row sits at &alpha;&nbsp;0.0. &ldquo;Other&rdquo; is every
              remaining token combined &mdash; not a token itself.
            </p>
          </section>
        </div>

        {/* 7. The fixed point of comparison, plus the way back to it. */}
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-4 sm:px-5">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-x-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                Neutral reference <span className="font-mono font-normal normal-case tracking-normal">&alpha; 0.0</span>
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--color-ink-2)]">
                <span className="text-[var(--color-ink-3)]">{scenario.prefix} </span>
                {neutral.continuation}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStateIndex(NEUTRAL_INDEX)}
              disabled={atNeutral}
              className="shrink-0 self-start rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-3 py-1.5 text-[13px] text-[var(--color-ink-2)] transition-colors hover:text-[var(--color-ink)] disabled:cursor-default disabled:border-[var(--color-line)] disabled:text-[var(--color-ink-3)] disabled:opacity-60"
            >
              {atNeutral ? 'At neutral' : 'Reset to neutral'}
            </button>
          </div>
        </section>

        {/* 8. The point of the whole thing. */}
        <section className="space-y-3">
          <p className="text-[15px] leading-relaxed text-[var(--color-ink)]">{scenario.takeaway}</p>
          <HowItWorks provenance={provenance} live={isLive} />
        </section>
      </div>

      {/*
        One polite announcement per settled state. Debouncing means a drag across the range is
        narrated once, when it lands, instead of nine times on the way.
      */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announced}
      </p>
    </div>
  );
}

export default SteeringShowcase;
