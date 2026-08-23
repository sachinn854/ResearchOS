"use client"

import { Blend, Blocks, FileSearch, History, Shield, Table2 } from "lucide-react"

import { Reveal } from "@/components/landing/reveal"

const CAPS = [
  { label: "Retrieval", value: "Dense + sparse + RRF", Icon: FileSearch },
  { label: "Citations", value: "Per-sentence, numbered [n]", Icon: Blocks },
  { label: "Rendering", value: "Tables, code & quotes", Icon: Table2 },
  { label: "Fusion", value: "Reranked passages", Icon: Blend },
  { label: "Sessions", value: "Private, per-user history", Icon: History },
  { label: "Trust", value: "Evidence beside prose", Icon: Shield },
]

const USE_CASES = [
  ["Literature review", "Ask across 30 papers and collect the passages that answer each subquestion."],
  ["Method comparisons", "\u201CHow does RAG compare with fine-tuning?\u201D — with tables you can paste into notes."],
  ["Definitions & explainers", "\u201CExplain attention in transformers\u201D — answered from your library, cited to the source."],
  ["Limitations & benchmarks", "Surface what the papers actually say about evaluation and failure cases."],
]

/** Spec sheet: capabilities as a two-column definition table, use cases as an
 *  indexed list. No cards-with-icons — the data is the design. */
export function Capabilities() {
  return (
    <section id="capabilities" className="mx-auto w-full max-w-[1080px] px-5 py-16 sm:px-6 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-[1.05fr_0.9fr] lg:gap-14">
        <Reveal>
          <p className="label-meta">Capabilities</p>
          <h2 className="font-display mt-3 text-display font-semibold leading-[1.06] tracking-[-0.03em] text-foreground">
            Built for research,<br />not demos.
          </h2>
          <p className="mt-4 max-w-[54ch] text-ui-lg leading-relaxed text-muted-foreground">
            The retrieval stack is transparent, the citations are interactive, and the prose renders
            like a document — because that is what an answer is.
          </p>

          <dl className="mt-8 border-t border-border">
            {CAPS.map((c, i) => (
              <Reveal key={c.label} delay={i * 60} className="flex items-center gap-3 border-b border-border py-3">
                <c.Icon className="size-4 shrink-0 text-brand-deep" />
                <dt className="w-28 shrink-0 font-mono text-meta uppercase tracking-[0.08em] text-ink-subtle">
                  {c.label}
                </dt>
                <dd className="text-ui font-medium text-foreground">{c.value}</dd>
              </Reveal>
            ))}
          </dl>
        </Reveal>

        <Reveal delay={100}>
          <div className="panel p-6 sm:p-7">
            <p className="label-meta">Use cases</p>
            <ul className="mt-2">
              {USE_CASES.map(([title, desc], i) => (
                <Reveal key={title} as="li" delay={i * 70} className="flex gap-4 border-b border-border py-4 last:border-b-0">
                  <span className="font-mono text-meta text-brand-deep">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <span className="block text-ui font-semibold text-foreground">{title}</span>
                    <span className="mt-1 block text-ui leading-relaxed text-muted-foreground">{desc}</span>
                  </span>
                </Reveal>
              ))}
            </ul>
          </div>

          <p className="mt-4 rounded-lg bg-brand-soft px-4 py-3 font-mono text-data leading-relaxed text-brand-deep">
            Your library stays yours — private per-account sessions, no training on your papers.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
