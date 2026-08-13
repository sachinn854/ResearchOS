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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 sm:px-6">
      <Link href="/" className="flex items-center gap-2.5" aria-label="ResearchOS home">
        <BrandMark size="md" />
        <span className="font-display hidden text-title-sm text-foreground sm:block">ResearchOS</span>
      </Link>

      <div className="mx-3 hidden h-5 w-px bg-border sm:block" />

      {onOpenHistory && (
        <button type="button" onClick={onOpenHistory} className="btn-quiet gap-2 px-2.5">
          <Clock className="size-4" />
          <span className="hidden sm:inline">Recent</span>
          {historyCount ? (
            <span className="font-mono text-meta text-ink-subtle">{historyCount}</span>
          ) : null}
        </button>
      )}

      <Link
        href="/ingest"
        aria-current={active === "ingest" ? "page" : undefined}
        className={cn("btn-quiet gap-2 px-2.5", active === "ingest" && "text-foreground")}
      >
        <FileUp className="size-4" />
        <span className="hidden sm:inline">Add a document</span>
      </Link>

      <div className="ml-auto flex items-center gap-2">
        {domain !== undefined && onDomainChange && (
          <>
            {/* The label is visually hidden rather than dropped: the control says
                "All domains", which reads as a state, not as the thing it scopes. */}
            <label htmlFor="thread-domain" className="sr-only">
              Scope the question to a domain
            </label>
            <DomainSelect
              id="thread-domain"
              value={domain}
              onChange={onDomainChange}
              includeAll
              className="h-9 w-auto min-w-36 rounded-lg"
            />
          </>
        )}

        <ThemeToggle className="size-9" />

        {user && (
          <>
            <span
              title={`${user.name} · ${user.email}`}
              className="bg-brand-soft text-brand-deep grid size-9 shrink-0 place-items-center rounded-lg text-ui font-bold"
            >
              {user.name.charAt(0).toUpperCase()}
            </span>
            <button
              type="button"
              onClick={() => { logout(); window.location.href = "/login" }}
              aria-label="Sign out"
              title="Sign out"
              className="btn-quiet size-9 p-0"
            >
              <LogOut className="size-4" />
            </button>
          </>
        )}
      </div>
    </header>
  )
}
