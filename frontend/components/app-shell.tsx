"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { FileUp, Menu, Plus, X } from "lucide-react"

import { BrandMark, Wordmark } from "@/components/brand-mark"
import { DomainSelect } from "@/components/domain-select"
import { ThemeToggle } from "@/components/theme-toggle"
import type { SessionItem } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { cn } from "@/lib/utils"

function timeAgo(isoStr: string | null): string {
  if (!isoStr) return ""
  const diff = Date.now() - new Date(isoStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/**
 * The app frame: one permanent left column carrying brand, the two primary
 * actions, the domain scope, the question history and the account — the way a
 * tool a person returns to all day earns a fixed band of the screen.
 *
 * Persistent from lg up. Below lg there is not 280px to spare next to a
 * reading column, so it becomes a drawer opened from a slim mobile header —
 * same markup, so the two can never drift apart.
 *
 * Drawer open/close state is internal on purpose: selecting a session or
 * starting a new question must close the drawer, and both happen here, so the
 * pages never have to pass open state back and forth.
 */
export function AppShell({
  sessions,
  activeSessionId,
  sessionsFailed,
  onRetry,
  onSelectSession,
  onNewChat,
  domain,
  onDomainChange,
  showLibrary = true,
  children,
}: {
  sessions: SessionItem[]
  activeSessionId: string | null
  sessionsFailed: boolean
  onRetry: () => void
  onSelectSession: (id: string) => void
  onNewChat: () => void
  domain: string
  onDomainChange: (value: string) => void
  /** Pages without sessions (e.g. ingest) hide the history section entirely —
   *  a list that is always empty is worse than no list. */
  showLibrary?: boolean
  children: React.ReactNode
}) {
  const { user, logout } = useAuth()
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navOpen])

  function handleSelect(id: string) {
    setNavOpen(false)
    onSelectSession(id)
  }
  function handleNewChat() {
    setNavOpen(false)
    onNewChat()
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <Link href="/" className="flex items-center gap-2.5" aria-label="ResearchOS home">
          <BrandMark size="sm" />
          <Wordmark className="text-[15px]" />
        </Link>
        <button
          type="button"
          onClick={() => setNavOpen(false)}
          aria-label="Close menu"
          className="ml-auto grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-list hover:text-foreground lg:hidden"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-2 px-3 pt-3 pb-4">
        <button type="button" onClick={handleNewChat} className="btn-primary w-full">
          <Plus className="size-4" />
          New question
        </button>
        <Link href="/ingest" className="btn-soft w-full">
          <FileUp className="size-4" />
          Add document
        </Link>
      </div>

      {showLibrary && (
        <>
          <div className="px-4 pb-2">
            <label htmlFor="shell-domain" className="label-meta block">Scope</label>
            <DomainSelect
              id="shell-domain"
              value={domain}
              onChange={onDomainChange}
              includeAll
              className="mt-1.5 h-9 w-full rounded-lg border-border bg-list px-3"
            />
          </div>

          <div className="mx-3 h-px bg-border" />

          <nav aria-label="Question history" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            <p className="label-meta px-2">Recent · {sessions.length}</p>
            <div className="mt-1.5 space-y-0.5">
              {sessionsFailed && sessions.length === 0 ? (
                <div className="px-2 py-3">
                  <p className="text-ui text-foreground">Your questions did not load.</p>
                  <button type="button" onClick={onRetry} className="link-primary mt-1 text-ui">
                    Try again
                  </button>
                </div>
              ) : sessions.length === 0 ? (
                <p className="px-2 py-3 text-ui text-muted-foreground">Nothing asked yet.</p>
              ) : (
                sessions.map(s => {
                  const isActive = s.session_id === activeSessionId
                  return (
                    <button
                      key={s.session_id}
                      type="button"
                      onClick={() => handleSelect(s.session_id)}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "group flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                        isActive
                          ? "border-brand-edge bg-brand-soft"
                          : "border-transparent hover:border-border hover:bg-list",
                      )}
                    >
                      <span
                        className={cn(
                          "line-clamp-2 text-ui leading-snug",
                          isActive ? "font-semibold text-foreground" : "text-foreground",
                        )}
                      >
                        {s.preview || "Empty question"}
                      </span>
                      <span className="font-mono text-meta text-ink-subtle">
                        {timeAgo(s.last_at)}
                        {s.message_count > 0 && ` · ${s.message_count} msg`}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </nav>
        </>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-border px-3 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary font-mono text-[12px] font-semibold text-primary-foreground">
          {user?.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-semibold text-foreground">{user?.name}</span>
          <span className="block truncate font-mono text-meta text-ink-subtle">{user?.email}</span>
        </span>
        <ThemeToggle className="size-8 shrink-0 rounded-lg" />
        <button
          type="button"
          onClick={() => { logout(); window.location.href = "/login" }}
          aria-label="Sign out"
          title="Sign out"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-list hover:text-foreground"
        >
          <LogOutIcon />
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Scrim only below lg — on a wide screen the sidebar is static chrome,
          not an overlay, so there is nothing to dim behind it. */}
      <div
        onClick={() => setNavOpen(false)}
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-black/45 transition-opacity duration-200 lg:hidden",
          navOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        aria-label="App navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[280px] shrink-0 flex-col border-r border-border bg-card",
          "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          navOpen ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-auto lg:translate-x-0 lg:transition-none",
        )}
      >
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Slim header only below lg — everything it carries lives in the
            sidebar from lg up. */}
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border bg-canvas/85 px-4 backdrop-blur-[14px] lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground"
          >
            <Menu className="size-4" />
          </button>
          <Wordmark className="text-[15px]" />
        </header>

        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

function LogOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}
