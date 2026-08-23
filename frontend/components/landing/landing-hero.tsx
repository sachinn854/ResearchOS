"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"

const DEMO_TOKENS = [
  "Hallucination in RAG is reduced by",
  " keeping retrieved passages aligned with the generated claim",
  " and verifying each sentence against its source.",
  " Citations bind every statement to a page [1][2] so you can audit the answer.",
]

const DEMO_SOURCES = [
  { n: 1, title: "Retrieval-Augmented Generation", meta: "p. 4 · 0.412" },
  { n: 2, title: "Faithful RAG — citation study", meta: "p. 11 · 0.387" },
  { n: 3, title: "Evaluation beyond BLEU", meta: "p. 2 · 0.361" },
]

export function LandingHero() {
  const [typed, setTyped] = useState("")
  const full = DEMO_TOKENS.join("")

  useEffect(() => {
    let i = 0
    let cancelled = false
    const id = window.setInterval(() => {
      if (cancelled) return
      i += 1
      setTyped(full.slice(0, i))
      if (i >= full.length) window.clearInterval(id)
    }, 14)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [full])

  return (
    <section className="relative overflow-hidden">
      {/* Blueprint grid fading down from the top edge — the one decorative
          texture in the system, and it lives here and on the CTA band only. */}
      <div aria-hidden className="grid-paper pointer-events-none absolute inset-0" />

      {/* Centered column, then the product panel full-width beneath it. */}
      <div className="relative mx-auto w-full max-w-[1080px] px-5 pt-16 sm:px-6 sm:pt-24">
        <div className="animate-rise-in mx-auto max-w-3xl text-center">
          <p className="label-meta inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 shadow-lift">
            <span className="size-1.5 rounded-full bg-primary" />
            Cited answers across your papers
          </p>

          <h1 className="font-display mt-7 text-display-lg font-semibold tracking-[-0.035em] text-foreground">
            Ask your library.
            <br />
            <span className="text-brand-deep">Get evidence back.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-[54ch] text-ui-lg leading-relaxed text-muted-foreground">
            ResearchOS reads every paper you give it and answers with receipts — page number,
            relevance score and the quoted passage behind each claim, one click away.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className="btn-primary px-6 py-3 text-base">
              Start asking questions
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/login" className="btn-soft px-6 py-3 text-base">
              Sign in
            </Link>
          </div>

          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-ui text-muted-foreground">
            {["Dense + sparse + RRF retrieval", "Numbered open citations", "Private per-account library"].map(t => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Product panel: a working mock of the answer screen. */}
        <div className="animate-rise-in relative mx-auto mt-14 max-w-[920px]" style={{ animationDelay: "90ms" }}>
          <div
            aria-hidden
            className="absolute -inset-x-8 -top-8 h-40 opacity-70 blur-[60px]"
            style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--primary) 22%, transparent), transparent)" }}
          />
          <div className="panel relative overflow-hidden p-3 shadow-panel sm:p-4">
            {/* window chrome */}
            <div className="flex items-center justify-between border-b border-border px-2 pb-3">
              <span className="font-mono text-meta text-ink-subtle">researchos / ask</span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-border-strong" />
                <span className="size-2.5 rounded-full bg-border-strong" />
                <span className="size-2.5 rounded-full bg-border-strong" />
              </span>
            </div>

            <div className="grid gap-3 p-2 sm:p-3 lg:grid-cols-[1fr_320px]">
              {/* answer side */}
              <div className="rounded-lg border border-border bg-list p-4">
                <p className="label-meta">Q01</p>
                <p className="font-display mt-1.5 text-title-sm font-semibold leading-snug text-foreground">
                  What reduces hallucination in retrieval-augmented generation?
                </p>
                <p className="mt-3 font-mono text-data leading-relaxed text-muted-foreground">
                  <span>{typed}</span>
                  <span className="ml-1 inline-block h-[1em] w-1.5 translate-y-[2px] rounded-[2px] bg-primary align-middle" />
                </p>
              </div>

              {/* evidence side */}
              <div className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                  <span className="label-meta">Evidence</span>
                  <span className="font-mono text-meta text-ink-subtle">3 passages</span>
                </div>
                <div className="space-y-1.5 p-2.5">
                  {DEMO_SOURCES.map(s => (
                    <div key={s.n} className="flex items-center gap-2.5 rounded-md border border-border bg-list px-2.5 py-2">
                      <span className="source-index">{s.n}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-data font-semibold text-foreground">{s.title}</span>
                        <span className="block font-mono text-meta text-ink-subtle">{s.meta}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
              <span className="inline-flex items-center gap-2 text-meta text-muted-foreground">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-success" />
                </span>
                Library indexed · ready to question
              </span>
              <span className="hidden font-mono text-meta text-ink-subtle sm:inline">PDF · DOCX · MD · TXT · links</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
