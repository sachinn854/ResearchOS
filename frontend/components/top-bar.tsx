"use client"

import Link from "next/link"
import { Clock, FileUp, LogOut } from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { DomainSelect } from "@/components/domain-select"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/lib/auth-context"
import { cn } from "@/lib/utils"

/**
 * The only chrome in the app.
 *
 * Everything that used to be a column is here. There was a 68px espresso icon
 * rail holding four buttons and a 288px panel holding a list — two permanent
 * vertical bands, 356px of the window, spent on navigation for an app with two
 * pages. Both are gone: the pages are two links, and the list is a panel you
 * open when you want it.
 *
 * What that bought is the second column further down, which now holds the
 * passages each answer was built from. That is the thing worth a permanent band
 * of the screen; a list of links was not.
 */
export function TopBar({
  active,
  onOpenHistory,
  historyCount,
  domain,
  onDomainChange,
}: {
  active: "chat" | "ingest"
  /** Omitted on /ingest, which has no history to show. */
  onOpenHistory?: () => void
  historyCount?: number
  /** Omitted on /ingest, where there is no question to scope. */
  domain?: string
  onDomainChange?: (value: string) => void
}) {
  const { user, logout } = useAuth()

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-canvas/80 px-4 backdrop-blur-[14px] sm:px-6">
      <Link href="/" className="flex items-center gap-2.5" aria-label="ResearchOS home">
        <BrandMark size="md" />
        <span className="font-display hidden text-title-sm text-foreground sm:block">ResearchOS</span>
      </Link>

      <div className="mx-3 hidden h-5 w-px bg-border sm:block" />

      {onOpenHistory && (
        <button
          type="button"
          onClick={onOpenHistory}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-semibold text-muted-foreground shadow-lift transition-colors hover:border-border-strong hover:text-foreground"
        >
          <Clock className="size-3.5" />
          <span className="hidden sm:inline">Recent</span>
          {typeof historyCount === "number" && (
            <span className="rounded-full bg-list px-1.5 py-0.5 font-mono text-[11px] leading-none text-ink-subtle">
              {historyCount}
            </span>
          )}
        </button>
      )}

      <Link
        href="/ingest"
        aria-current={active === "ingest" ? "page" : undefined}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors",
          active === "ingest"
            ? "border-brand-edge bg-brand-soft text-brand-deep"
            : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
        )}
      >
        <FileUp className="size-3.5" />
        <span className="hidden sm:inline">Add a document</span>
      </Link>

      <div className="ml-auto flex items-center gap-2">
        {domain !== undefined && onDomainChange && (
          // Hidden below sm: at phone widths this plus the history pill, the
          // ingest link, the theme toggle and the account controls do not fit
          // in one 14-height row. Scoping to a domain is a refinement on top
          // of asking, not a control the first render of a phone screen must
          // carry — it reappears the moment there is room for it.
          <div className="hidden items-center sm:flex">
            <label htmlFor="thread-domain" className="sr-only">
              Scope the question to a domain
            </label>
            <DomainSelect
              id="thread-domain"
              value={domain}
              onChange={onDomainChange}
              includeAll
              className="h-9 w-auto min-w-36 rounded-full border-border bg-card px-3.5"
            />
          </div>
        )}

        <ThemeToggle className="size-9 rounded-full border border-border bg-card" />

        {user && (
          <>
            <span
              title={`${user.name} · ${user.email}`}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-[13px] font-bold text-primary-foreground"
            >
              {user.name.charAt(0).toUpperCase()}
            </span>
            <button
              type="button"
              onClick={() => {
                logout()
                window.location.href = "/login"
              }}
              aria-label="Sign out"
              title="Sign out"
              className="grid size-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </>
        )}
      </div>
    </header>
  )
}
