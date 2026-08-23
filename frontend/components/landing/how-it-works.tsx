"use client"

import { Braces } from "lucide-react"

import { Reveal } from "@/components/landing/reveal"

const STEPS = [
  {
    k: "01",
    title: "Ask",
    desc: "Type a research question in plain language. Scope it to a domain — or ask across everything.",
  },
  {
    k: "02",
    title: "Retrieve",
    desc: "Dense + sparse search over your papers, fused with RRF and ranked by meaning.",
  },
  {
    k: "03",
    title: "Verify & cite",
    desc: "Each claim is written against retrieved text and bound to a passage [1] you can open and quote.",
  },
]

/** A horizontal pipeline readout. The connector line is a straight read of the
 *  numbering: three steps in order, not three options — it only renders where
 *  the cards actually sit in a row. */
export function HowItWorks() {
  return (
    <section id="how" className="border-y border-border bg-card">
      <div className="mx-auto w-full max-w-[1080px] px-5 py-16 sm:px-6 sm:py-20">
        <Reveal className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-xl">
            <p className="label-meta">How it works</p>
            <h2 className="font-display mt-3 text-display font-semibold leading-[1.06] tracking-[-0.03em] text-foreground">
              Three steps. Every answer cites its page.
            </h2>
          </div>
          <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-list px-3 py-1.5 font-mono text-meta text-ink-subtle">
            <Braces className="size-3.5" /> 30–60s end to end
          </span>
        </Reveal>

        <div className="relative mt-12 grid gap-8 lg:grid-cols-3 lg:gap-4">
          {/* The connector draws itself left-to-right the first time the section
              crosses into view — the line literally performs the sequence. */}
          <Reveal
            as="span"
            delay={150}
            aria-hidden
            className="line-draw absolute top-[13px] right-[16%] left-[16%] hidden h-px bg-border-strong lg:block"
          />
          {STEPS.map((s, i) => (
            <Reveal key={s.k} delay={i * 90}>
              <div className="relative">
                <span className="relative z-10 inline-grid size-7 place-items-center rounded-full border border-border-strong bg-card font-mono text-[11px] font-semibold text-brand-deep">
                  {s.k.slice(-1)}
                </span>
                <h3 className="font-display mt-5 text-title font-semibold tracking-[-0.02em] text-foreground">
                  {s.title}
                </h3>
                <p className="mt-2 max-w-[44ch] text-ui leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={140} className="mt-14 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-canvas p-5 sm:p-6">
          <p className="max-w-[52ch] text-ui-lg leading-relaxed text-foreground">
            Answers stream with citations attached — tap any marker to open the quoted text.
          </p>
          <a href="/signup" className="btn-primary shrink-0">Create your library</a>
        </Reveal>
      </div>
    </section>
  )
}
