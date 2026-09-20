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
          Representation steering changes a model&rsquo;s internal activations during generation.
          Here a steering vector <Sym>v</Sym> is added to a hidden representation <Sym>h</Sym> at a
          selected layer: <Sym>h&#8242; = h + &alpha;cv</Sym>. The slider controls{' '}
          <Sym>&alpha;</Sym>; <Sym>c</Sym> is a fixed per-scenario coefficient shown in the badge,
          so the badge reading &ldquo;c&nbsp;=&nbsp;2&rdquo; at <Sym>&alpha;</Sym>&nbsp;=&nbsp;1
          means the vector was added twice over. At zero, no steering is applied; positive and
          negative values move in opposite directions.
        </p>

        <p>
          {live
            ? 'These results were computed on Hugging Face during this visit.'
            : 'These results were generated in advance and ship with the page.'}{' '}
          The chart shows probabilities for the token immediately after the fixed opening words,
          and the response shows the corresponding generated continuation. The rows are the tokens
          that win somewhere on the slider, not necessarily the three most likely at the current
          setting; &ldquo;All other tokens&rdquo; is the combined remainder of the vocabulary. A
          token is a unit of model text and may be a word or part of a word.
        </p>

        <p>
          A higher probability does not always change the selected token. These runs use greedy
          decoding, which takes the highest-scoring token at each step, with sampling and any
          packaged repetition penalty switched off so the first generated token is exactly the
          argmax shown beside it. Steering effects can be uneven, and stronger steering can reduce
          fluency or change unrelated details &mdash; both are visible on the slider.
        </p>

        <p>
          Responses are the model&rsquo;s own words, unedited. Generation stops at an
          end-of-sequence token or at a 40-token limit; a trailing ellipsis means the limit was
          reached and the model was still going. Repetition and unfinished clauses are left in
          rather than tidied away, because editing them would break the claim that this is what
          the model produced.
        </p>

        <p>
          <strong className="font-medium text-[var(--color-ink)]">Your own prompt.</strong> With a
          live service configured, the prompt and opening words are editable and can be measured
          for real. The steering direction is still the selected scenario&rsquo;s, re-derived from
          its contrast examples in the context of your prompt. Expect mixed results: a direction
          found for one question does not always transfer.
        </p>

        <p className="text-[var(--color-ink-3)]">
          Scenario text, opening words, direction labels and takeaways are written by hand. The
          candidate tokens, probabilities and responses are measured from{' '}
          <Model>{model}</Model>. The layer and coefficient were chosen by sweeping both and
          keeping the setting where the intended contrast appeared most clearly &mdash; those are
          selected demonstration settings, not evidence of general effectiveness. The models here
          are deliberately small; none of this is a result about how larger systems behave.
          {provenance ? ` Measured ${provenance.measured}.` : ''} Method and data:{' '}
          <a
            className="underline underline-offset-2 hover:text-[var(--color-ink-2)]"
            href="https://github.com/steering-demo/steering-demo.github.io/blob/main/docs/MEASUREMENT.md"
          >
            docs/MEASUREMENT.md
          </a>
          .
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
