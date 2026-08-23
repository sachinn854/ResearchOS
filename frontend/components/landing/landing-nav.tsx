"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { BrandMark } from "@/components/brand-mark"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"

/** A floating pill: the nav is an object on the page, not a band across it.
 *  Two scroll behaviours attach to it: the pill gains a firmer border once the
 *  page moves, and a hairline progress bar under it fills as you read — the
 *  only scroll-linked animation on the page that runs continuously. */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let ticking = false
    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const doc = document.documentElement
        const max = doc.scrollHeight - window.innerHeight
        setScrolled(window.scrollY > 8)
        setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0)
        ticking = false
      })
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header className="sticky top-4 z-30 px-4">
      <div
        className={cn(
          "relative mx-auto flex h-14 w-full max-w-[1080px] items-center gap-5 overflow-hidden rounded-2xl border bg-card/85 pl-4 pr-2.5 backdrop-blur-[16px] transition-shadow duration-300 sm:pl-5",
          scrolled ? "border-border-strong shadow-lift" : "border-border shadow-lift",
        )}
      >
        <Link href="/" className="flex items-center gap-2.5" aria-label="ResearchOS">
          <BrandMark size="sm" />
          <span className="font-display hidden text-[15px] font-semibold tracking-[-0.02em] text-foreground sm:block">
            Research<span className="text-brand-deep">OS</span>
          </span>
          <span className="ml-1 hidden rounded-md border border-border bg-list px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-subtle lg:inline-flex">
            Research preview
          </span>
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          <a href="#features" className="btn-quiet px-3 py-1.5">Features</a>
          <a href="#how" className="btn-quiet px-3 py-1.5">How it works</a>
          <a href="#capabilities" className="btn-quiet px-3 py-1.5">Capabilities</a>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle className="size-9" />
          <Link href="/login" className="btn-quiet hidden px-3 py-2 text-ui font-semibold sm:inline-flex">
            Sign in
          </Link>
          <Link href="/signup" className="btn-primary h-9 gap-1.5 rounded-lg px-4 text-ui">
            Get started
            <ArrowUpRight className="size-3.5 opacity-70" />
          </Link>
        </div>

        {/* Reading progress. scaleX, not width: transforms don't relayout. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-primary transition-transform duration-150 ease-out"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </header>
  )
}
