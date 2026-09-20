import type { Provenance } from '../lib/types';

export interface HowItWorksProps {
  provenance?: Provenance;
  /** True when the numbers on screen were computed by the Space during this visit. */
  live: boolean;
}

export function HowItWorks({ provenance, live }: HowItWorksProps) {
  const model = provenance?.model ?? 'a small open-weights model';

  return (
    <details className="group rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)]">
      <summary className="cursor-pointer list-none rounded-xl px-4 py-3 text-sm font-medium text-[var(--color-ink-2)] marker:content-none hover:text-[var(--color-ink)]">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
            &rsaquo;
          </span>
          How this works
        </span>
      </summary>

      <div className="space-y-3 border-t border-[var(--color-line)] px-4 py-4 text-[14px] leading-relaxed text-[var(--color-ink-2)]">
        <p>
          A language model builds an internal representation at every position as it reads,
          written <Sym>h</Sym> here. Representation steering picks a direction <Sym>v</Sym> in that
          space and adds a signed multiple of it, <Sym>&alpha;</Sym>, so the model carries on from
          a modified state <Sym>h&#8242;</Sym>. The edit happens inside the network &mdash; which
          is not the same as editing the output scores.
        </p>

        <p>
          <strong className="font-medium text-[var(--color-ink)]">These numbers are real.</strong>{' '}
          Each percentage is <Model>{model}</Model>&rsquo;s actual next-token distribution at the
          position after the prefix, and each sentence is what the steered model actually wrote
          under greedy decoding.{' '}
          {live
            ? 'What you are looking at was computed during this visit.'
            : 'What you are looking at was recorded ahead of time and ships with the page; when the live service is reachable it is recomputed on the spot.'}
        </p>

        <p>
          <Sym>v</Sym> is a{' '}
          <strong className="font-medium text-[var(--color-ink)]">difference of means</strong>. The
          model is shown a handful of continuations from each end of the scenario&rsquo;s axis, and{' '}
          <Sym>v</Sym> is the average activation for one end minus the average for the other. It is
          added to the residual stream at a single layer, at every position. Which layer, and how
          strongly, were chosen by sweeping both and keeping the setting where the contrast showed
          most clearly without the model losing fluency. That choice is a judgement call; the
          probabilities that follow from it are measurements.
        </p>

        <p>
          Each prefix ends on an intensifier &mdash; &ldquo;was absolutely&rdquo;, &ldquo;opened
          rather&rdquo; &mdash; so the very next token is the one carrying the meaning. Without
          that, the likeliest next word is a grammatical one like &ldquo;a&rdquo;, and the
          interesting choice happens further along, where a single-position chart cannot reach it.
        </p>

        <p>
          The chart covers{' '}
          <strong className="font-medium text-[var(--color-ink)]">one position only</strong>. Its
          rows are the tokens that actually win somewhere on the slider; &ldquo;Other&rdquo; is
          every remaining token added together, not a token. Other is often the largest row, and
          that is the honest picture: the model is choosing among tens of thousands of options, and
          steering moves a real but partial share of them.
        </p>

        <p>
          Notice the response is{' '}
          <strong className="font-medium text-[var(--color-ink)]">not smooth or symmetric</strong>.
          Some steps change nothing, others flip the winner, and one direction usually needs more
          push than the other. That is what steering a real model looks like. Push too far and the
          effect flattens, fluency suffers, or unrelated behaviour shifts &mdash; which is why a
          useful range is found by experiment.
        </p>

        <p>
          Negative and positive name{' '}
          <strong className="font-medium text-[var(--color-ink)]">
            which way along the direction
          </strong>
          , not which output is better. Neither end is.
        </p>

        <p className="text-[var(--color-ink-3)]">
          The prompts, prefixes, direction labels and takeaways are written by hand; the candidate
          tokens, probabilities and continuations are not. This is a deliberately small model, fast
          and cheap to run &mdash; an illustration of the mechanism, not a result about how larger
          systems behave.
          {provenance ? ` Measured ${provenance.measured}.` : ''}
        </p>

      </div>
    </details>
  );
}

function Sym({ children }: { children: React.ReactNode }) {
  return <span className="font-mono italic text-[var(--color-ink)]">{children}</span>;
}

function Model({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[13px] text-[var(--color-ink)]">{children}</span>;
}
