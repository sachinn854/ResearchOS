"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { Reveal } from "@/components/landing/reveal"

/** The closing band goes dark — the only full-bleed dark surface on the light
 *  landing page, so the last thing the page says is also its loudest. */
export function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-[1080px] px-5 pb-20 sm:px-6">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl bg-[#12101f] p-8 text-white sm:p-14">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(rgba(165,180,252,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(165,180,252,0.09) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
              maskImage: "radial-gradient(ellipse 80% 100% at 50% 100%, black 30%, transparent 75%)",
            }}
          />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(640px 380px at 82% 110%, rgba(99,102,241,0.35), transparent 65%)",
            }}
          />

          <div className="relative max-w-xl">
            <p className="font-mono text-meta font-medium uppercase tracking-[0.16em] text-indigo-300/80">
              Start in under a minute
            </p>
            <h2 className="font-display mt-4 text-display font-semibold leading-[1.06] tracking-[-0.03em]">
              Turn your papers into answers you can cite.
            </h2>
            <p className="mt-5 max-w-[52ch] text-ui-lg leading-relaxed text-indigo-100/70">
              Add your library, ask in natural language, and get documented answers with page,
              score and quoted passage — ready to paste into notes or a manuscript.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold text-[#12101f] transition-transform hover:scale-[1.02]"
              >
                Create account
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center rounded-lg border border-white/25 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
