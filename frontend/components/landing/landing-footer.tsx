"use client"

import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"

export function LandingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4 px-5 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <BrandMark size="sm" />
          <span className="font-display text-ui font-semibold tracking-[-0.02em] text-foreground">ResearchOS</span>
          <span className="hidden text-ui text-muted-foreground sm:inline">Cited answers across your papers.</span>
        </div>
        <div className="flex flex-wrap items-center gap-5 text-ui text-muted-foreground">
          <Link href="/login" className="hover:text-foreground">Sign in</Link>
          <Link href="/signup" className="hover:text-foreground">Create account</Link>
          <Link href="/ingest" className="hover:text-foreground">Add a document</Link>
          <span className="font-mono text-meta text-ink-subtle">© {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  )
}
