"use client"

import { FileCheck2, Library, Quote, Search, Sparkles } from "lucide-react"

import { Reveal } from "@/components/landing/reveal"
import { cn } from "@/lib/utils"

const FEATURES = [
  {
    title: "Cited, not claimed",
    desc: "Every sentence can point to the page it came from — relevance score and the quoted passage, openable in place.",
    Icon: Quote,
    wide: true,
  },
  {
    title: "Ask in your own words",
    desc: "No keywords, no filters. Natural questions matched against the full text of every paper.",
    Icon: Search,
    wide: false,
  },
  {
    title: "Verified before it streams",
    desc: "Retrieval, grading and citation binding happen before the first token arrives.",
    Icon: FileCheck2,
    wide: false,
  },
  {
    title: "A real library",
    desc: "PDFs, DOCX, TXT, MD or links. Private to your workspace and ready to question in under a minute.",
    Icon: Library,
    wide: false,
  },
  {
    title: "Built for long sessions",
    desc: "A calm graphite surface, generous reading measure and answers that render as documents — tables, code and quotes included. Comfortable for hours, not just demos.",
    Icon: Sparkles,
    wide: true,
  },
]

/** Bento layout: two feature cards span double width and carry more copy; the
 *  rest sit beside them. Mono indices instead of icon tiles keep it feeling
 *  like a spec sheet rather than an app store. */
export function FeatureGrid() {
  return (
    <section id="features" className="mx-auto w-full max-w-[1080px] px-5 py-16 sm:px-6 sm:py-24">
      <Reveal className="max-w-xl">
        <p className="label-meta">Why ResearchOS</p>
        <h2 className="font-display mt-3 text-display font-semibold leading-[1.06] tracking-[-0.03em] text-foreground">
          A reference workspace,<br />not a chatbot.
        </h2>
      </Reveal>

      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <Reveal
            key={f.title}
            delay={i * 60}
            className={cn(f.wide ? "lg:col-span-2" : "lg:col-span-1")}
          >
            <article className="group panel h-full p-5 transition-colors duration-300 hover:border-brand-edge sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <f.Icon className="size-4 text-brand-deep" />
                <span className="font-mono text-meta text-ink-subtle">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="font-display mt-8 text-title-sm font-semibold tracking-[-0.02em] text-foreground sm:mt-12">
                {f.title}
              </h3>
              <p className="mt-2 text-ui leading-relaxed text-muted-foreground">{f.desc}</p>
            </article>
          </Reveal>
        ))}

        {/* Filler tile keeps the bento grid rectangular at lg. */}
        <Reveal delay={300} className="hidden lg:col-span-1 lg:block">
          <div className="grid-paper flex h-full min-h-[180px] items-end rounded-xl border border-border bg-list p-5">
            <p className="font-display text-title-sm font-semibold leading-tight tracking-[-0.02em] text-foreground">
              Your papers,<br />
              <span className="text-brand-deep">on tap.</span>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
