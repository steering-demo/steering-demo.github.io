import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useAnimatedNumbers, useDebounced, usePrefersReducedMotion } from '../lib/hooks';
import { TOKEN_OTHER, candidateColor } from '../lib/palette';
import { runLiveScenario } from '../lib/live';
import { DEFAULT_LIVE_MODEL } from '../lib/models';
import { NEUTRAL_INDEX, formatAlpha, type Provenance, type Scenario } from '../lib/types';
import {
  identityKey,
  isStale,
  recordedIdentity,
  spokenPercent,
  type ResultIdentity,
} from '../lib/result';
import { AlphaSlider } from './AlphaSlider';
import { CompletionPanel } from './CompletionPanel';
import { HowItWorks } from './HowItWorks';
import { LiveControls } from './LiveControls';
import { ResultBadge, type LiveState } from './ResultBadge';
import { PromptPanel } from './PromptPanel';
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
  const [live, setLive] = useState<
    Record<string, { scenario: Scenario; identity: ResultIdentity; requestKey: string }>
  >({});
  const [liveState, setLiveState] = useState<LiveState>('idle');
  const [liveError, setLiveError] = useState<string>();
  const [model, setModel] = useState(DEFAULT_LIVE_MODEL);
  const [draft, setDraft] = useState<{ prompt: string; prefix: string } | null>(null);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const panelId = useId();

  const recorded = useMemo(
    () => scenarios.find((item) => item.id === scenarioId) ?? scenarios[0],
    [scenarios, scenarioId],
  );

  const prompt = draft?.prompt ?? recorded.prompt;
  const prefix = draft?.prefix ?? recorded.prefix;
  const edited = prompt !== recorded.prompt || prefix !== recorded.prefix;

  // `?live=0` hides the live controls entirely, which keeps the page purely static for anyone who
  // wants that - and keeps the browser tests deterministic.
  const [liveOptOut, setLiveOptOut] = useState(false);
  useEffect(() => {
    setLiveOptOut(new URLSearchParams(window.location.search).get('live') === '0');
  }, []);
  const liveAvailable = Boolean(spaceUrl) && !liveOptOut;

  /** The configuration a live run started right now would measure. */
  const requestIdentity: ResultIdentity = {
    source: 'live',
    model,
    scenarioId: recorded.id,
    prompt,
    prefix,
    direction: recorded.id,
  };
  const requestKey = identityKey(requestIdentity);

  // The saved example is on screen until a live result exists for this exact configuration.
  const shown = shownKey ? live[shownKey] : undefined;
  const scenario = shown?.scenario ?? recorded;
  const identity =
    shown?.identity ??
    recordedIdentity(
      recorded,
      provenance?.model ?? 'unknown',
      provenance?.revision,
      provenance?.measured,
    );
  const stale = isStale(identity, prompt, prefix);

  const inFlight = useRef<AbortController | null>(null);
  /**
   * The only live reply this component will accept.
   *
   * The previous guard compared a key captured when the request started against a key rebuilt
   * from the same render closure. Both values came from the same place, so they always matched
   * and no reply was ever rejected. A counter is the thing that actually moves when the visitor
   * changes the model, edits the prompt, or switches scenario, so that is what decides.
   */
  const acceptedRequest = useRef(0);

  /** Abandons any request in flight. Its reply, success or failure, will be ignored. */
  const cancelInFlight = useCallback(() => {
    acceptedRequest.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  useEffect(() => () => inFlight.current?.abort(), []);

  /**
   * Changing the model invalidates a run started for the previous one.
   *
   * Without this the old reply arrives, is accepted, and the badge names the model the visitor
   * just navigated away from while the dropdown shows the new one.
   */
  const changeModel = useCallback(
    (next: string) => {
      cancelInFlight();
      setModel(next);
      // Clear the failure itself, not just its message. Clearing only the text left the failure
      // pill on screen stripped of the one detail that made it actionable, describing a run for
      // a model the visitor had already moved away from.
      setLiveError(undefined);
      setLiveState((current) => (current === 'running' || current === 'error' ? 'idle' : current));
    },
    [cancelInFlight],
  );

  /** Same for editing the prompt: a reply for the old text is no longer an answer. */
  const changeDraft = useCallback(
    (next: { prompt: string; prefix: string }) => {
      cancelInFlight();
      setDraft(next);
      setLiveError(undefined);
      setLiveState((current) => (current === 'running' || current === 'error' ? 'idle' : current));
    },
    [cancelInFlight],
  );

  const runLive = useCallback(() => {
    if (!spaceUrl) return;
    cancelInFlight();
    const ticket = acceptedRequest.current;
    const controller = new AbortController();
    inFlight.current = controller;
    setLiveState('running');
    setLiveError(undefined);

    runLiveScenario(spaceUrl, recorded.id, {
      signal: controller.signal,
      // Re-running the same text is a deliberate act, so bypass the Space's cache unless the
      // visitor changed something, in which case a cache hit is a genuine answer.
      //
      // Compared against the request that produced what is on screen, not against the reply's
      // key. The Space may answer on a different model than the one asked for - it falls back to
      // its default for anything it does not recognise - and keying this off the reply meant the
      // two could never match, so pressing Run again could never force a real run.
      fresh: !edited && shown?.requestKey === requestKey,
      model,
      prompt: edited ? prompt : undefined,
      prefix: edited ? prefix : undefined,
    })
      .then((result) => {
        if (ticket !== acceptedRequest.current) return;
        // Built from the reply, not from the request. The Space collapses whitespace, can fall
        // back to the scenario's own text, and may answer on a different model than the one
        // asked for - so the badge describes what ran, not what was requested.
        const resolved: ResultIdentity = {
          source: 'live',
          model: result.model,
          revision: result.revision,
          scenarioId: recorded.id,
          prompt: result.scenario.prompt,
          prefix: result.scenario.prefix,
          direction: result.direction ?? recorded.id,
          layer: result.scenario.layer,
          coefficient: result.scenario.coefficient,
          cached: result.cached,
          staleCache: result.staleCache,
          cacheNote: result.cacheNote,
          ageSeconds: result.ageSeconds,
        };
        const key = identityKey(resolved);
        setLive((current) => ({
          ...current,
          [key]: { scenario: result.scenario, identity: resolved, requestKey },
        }));
        setShownKey(key);
        setLiveState('live');
        setStateIndex(NEUTRAL_INDEX);
      })
      .catch((error: unknown) => {
        // A failure belonging to a request the visitor has moved on from must not replace a
        // newer result that succeeded.
        if (ticket !== acceptedRequest.current) return;
        setLiveError(error instanceof Error ? error.message : String(error));
        setLiveState('error');
      });
  }, [spaceUrl, cancelInFlight, requestKey, recorded.id, model, edited, prompt, prefix, shownKey]);

  const revertToRecorded = useCallback(() => {
    cancelInFlight();
    setDraft(null);
    setShownKey(null);
    setLiveState('idle');
    setLiveError(undefined);
    setStateIndex(NEUTRAL_INDEX);
  }, [cancelInFlight]);

  const state = scenario.states[stateIndex] ?? scenario.states[NEUTRAL_INDEX];
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
      label: 'All other',
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
      .map((candidate, index) => `${candidate.label} ${spokenPercent(state.probabilities[index])}`)
      .join(', ')}, and ${spokenPercent(state.other)} for all other tokens combined.`;

  const direction =
    state.alpha === 0
      ? 'no steering applied'
      : `steering toward ${state.alpha < 0 ? scenario.negativeLabel : scenario.positiveLabel}`;

  const sliderValueText =
    `${spokenAlpha(state.alpha)} of minus 2 to plus 2. ${
      direction.charAt(0).toUpperCase() + direction.slice(1)
    }. Most likely next token: ${selected.label}, ${spokenPercent(selectedProbability)}.`;

  const announcement =
    `${spokenAlpha(state.alpha)}, ${direction}. ` +
    `Next token ${selected.label}, ${spokenPercent(selectedProbability)}. ` +
    `Completion: ${scenario.prefix} ${state.continuation}`;
  const announced = useDebounced(announcement, ANNOUNCE_DELAY_MS);

  const atNeutral = stateIndex === NEUTRAL_INDEX;

  function selectScenario(id: string) {
    cancelInFlight();
    setScenarioId(id);
    setStateIndex(NEUTRAL_INDEX);
    setDraft(null);
    setShownKey(null);
    setLiveState('idle');
    setLiveError(undefined);
  }

  return (
    <div className="min-w-0">
      {/*
        Where the numbers came from, and the way to measure them again, on one line: the run is
        the action on the provenance. This row was half-empty and the controls were a 57px strip
        of their own at the top of the instrument, which is the height of the first viewport.
      */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ResultBadge identity={identity} stale={stale} state={liveState} />
        {liveAvailable && (
          <LiveControls
            state={liveState}
            model={model}
            onModelChange={changeModel}
            error={liveError}
            edited={edited}
            onRun={runLive}
            onRevert={revertToRecorded}
            showRevert={identity.source === 'live' || edited}
          />
        )}
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
        className="mt-3"
      >
        {/*
          The instrument: everything the visitor sets. One surface with a hairline inside it, so
          the prompt, the opening words and the slider read as one control rather than cards of
          equal weight.
        */}
        <section
          aria-label="Steering controls"
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)]"
        >
          <div className="px-4 py-4 sm:px-5">
            <PromptPanel
              prompt={prompt}
              prefix={prefix}
              onChange={liveAvailable ? changeDraft : null}
              edited={edited}
              maxPrompt={300}
              maxPrefix={100}
            />
          </div>

          <div className="border-t border-[var(--color-line)] px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
            <AlphaSlider
              stateIndex={stateIndex}
              onChange={setStateIndex}
              negativeLabel={scenario.negativeLabel}
              positiveLabel={scenario.positiveLabel}
              valueText={sliderValueText}
              scenarioTitle={scenario.title}
            />
          </div>
        </section>

        {/*
          The reading: what came out. The response and the chart share one surface, divided by a
          hairline that turns horizontal below lg; the unsteered reference is the panel's footer,
          the fixed point everything above it is read against.
        */}
        <section
          aria-label="Model output"
          className="mt-4 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)]"
        >
          <div className="grid lg:grid-cols-2">
            <div className="p-4 sm:p-5">
              <CompletionPanel
                prefix={scenario.prefix}
                continuation={state.continuation}
                tokenLabel={selected.label}
                color={selectedColor}
                probability={selectedProbability}
              />
            </div>

            <div className="border-t border-[var(--color-line)] p-4 sm:p-5 lg:border-l lg:border-t-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                  Next-token probabilities
                </h3>
                <p className="text-[12px] text-[var(--color-ink-3)]">
                  for the token right after the opening words
                </p>
              </div>
              <div className="mt-3">
                <TokenChart
                  key={`${scenario.id}-${identity.source}`}
                  rows={rows}
                  summary={chartSummary}
                  alphaLabel={`alpha ${formatAlpha(state.alpha)}`}
                />
              </div>
              <p className="mt-2 text-[12px] leading-snug text-[var(--color-ink-3)]">
                <span aria-hidden="true" className="mr-1 inline-block h-[10px] w-[2px] translate-y-[1px] bg-[var(--color-ink-2)]" />
                Thin markers show probabilities without steering. &ldquo;All other tokens&rdquo; is
                the combined remainder of the vocabulary, not a token itself.
              </p>
            </div>
          </div>

          <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-3 sm:px-5">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-x-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                  Without steering <span className="font-mono font-normal normal-case tracking-normal">&alpha; 0.0</span>
                </h3>
                <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-ink-2)]">
                  <span className="text-[var(--color-ink-3)]">{scenario.prefix} </span>
                  {neutral.continuation}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStateIndex(NEUTRAL_INDEX)}
                disabled={atNeutral}
                className="pressable shrink-0 self-start rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-3 py-1.5 text-[13px] text-[var(--color-ink-2)] hover:text-[var(--color-ink)] disabled:cursor-default disabled:border-[var(--color-line)] disabled:text-[var(--color-ink-3)] disabled:opacity-60"
              >
                {atNeutral ? 'At \u03b1 = 0' : 'Reset to \u03b1 = 0'}
              </button>
            </div>
          </div>
        </section>

        {/*
          The explanation: unboxed, with room above it. A heading in the page's own voice rather
          than an eyebrow, so the results visibly end and the reasoning begins. The schematic keeps
          its own drawn frame; it is a figure, not a card.
        */}
        <section aria-labelledby="mechanism-heading" className="mt-10">
          <h2
            id="mechanism-heading"
            className="text-[17px] font-semibold leading-snug tracking-tight text-[var(--color-ink)]"
          >
            What changes inside the model
          </h2>
          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center">
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
                <em className="not-italic">&alpha;cv</em>
              </p>
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] leading-snug">
                {[
                  ['h', 'representation before the intervention'],
                  ['v', 'steering direction'],
                  ['α', 'the slider: steering strength and sign'],
                  [
                    'c',
                    scenario.coefficient === undefined
                      ? 'fixed per-scenario coefficient'
                      : `fixed per-scenario coefficient, here ${scenario.coefficient}`,
                  ],
                  ['h′', 'representation after the intervention'],
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

          <p className="mt-6 text-[15px] leading-relaxed text-[var(--color-ink)]">{scenario.takeaway}</p>
          <div className="mt-4">
            <HowItWorks identity={identity} />
          </div>
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
