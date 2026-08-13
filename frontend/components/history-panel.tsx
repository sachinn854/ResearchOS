"use client"

import { useEffect, useRef } from "react"
import { Plus, X } from "lucide-react"

import type { SessionItem } from "@/lib/api"
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
 * Past questions, in a panel you open rather than a column that is always there.
 *
 * The old column was 288px of the window, permanently, for a list most people
 * touch once a session. As a panel it can be wider than that column ever was, so
 * a question is readable instead of clipped at four words — the thing the column
 * was too narrow to do is exactly what it existed for.
 */
export function HistoryPanel({
  open,
  onClose,
  sessions,
  activeSessionId,
  sessionsFailed,
  onRetry,
  onSelect,
  onNewChat,
}: {
  open: boolean
  onClose: () => void
  sessions: SessionItem[]
  activeSessionId: string | null
  sessionsFailed: boolean
  onRetry: () => void
  onSelect: (id: string) => void
  onNewChat: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    // Escape closes it. Without this the only way out of a panel that covers the
    // question you were reading is to find the button that dismisses it.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)

    // Move focus into the panel so the keyboard is where the eye is. Restoring it
    // afterwards is deliberately not done: every path out of here either closes
    // the panel and stays put, or loads a different conversation, and returning
    // focus to a button behind a conversation that just changed is worse than
    // leaving it at the top of the new one.
    panelRef.current?.focus()

    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Recent questions"
        tabIndex={-1}
        // Kept mounted and translated off-screen rather than unmounted, so the
        // close is animated too. inert while hidden, so nothing inside is
        // tabbable or reachable by a screen reader when it is not on screen.
        inert={!open}
        className={cn(
          "bg-card fixed inset-y-0 left-0 z-50 flex w-full max-w-md flex-col border-r border-border",
          "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] outline-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <h2 className="text-ui-lg font-bold text-foreground">Recent questions</h2>
          <span className="font-mono text-meta text-ink-subtle">{sessions.length}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-quiet ml-auto size-9 p-0">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-4 py-3">
          <button type="button" onClick={onNewChat} className="btn-soft w-full justify-start gap-2 py-2.5">
            <Plus className="text-brand-deep size-4" />
            Ask something new
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          {sessionsFailed && sessions.length === 0 ? (
            <div className="px-5 py-6">
              <p className="text-ui-lg text-foreground">Your questions did not load.</p>
              <p className="mt-1 text-ui text-muted-foreground">
                The list is fetched separately from the page, so the rest still works.
              </p>
              <button type="button" onClick={onRetry} className="link-primary mt-3 text-ui">
                Try loading them again
              </button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-5 py-6">
              <p className="text-ui-lg text-foreground">Nothing asked yet.</p>
              <p className="mt-1 text-ui text-muted-foreground">
                Your questions collect here as you ask them.
              </p>
            </div>
          ) : (
            sessions.map(s => {
              const isActive = s.session_id === activeSessionId
              return (
                <button
                  key={s.session_id}
                  type="button"
                  onClick={() => onSelect(s.session_id)}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "w-full border-l-2 px-5 py-3 text-left transition-colors",
                    isActive ? "border-primary bg-brand-soft" : "hover:bg-surface-raised border-transparent",
                  )}
                >
                  <span className="block text-ui-lg font-semibold text-foreground">
                    {s.preview || "Empty question"}
                  </span>
                  <span className="mt-1 block font-mono text-meta text-ink-subtle">
                    {timeAgo(s.last_at)}
                    {s.message_count > 0 && ` · ${s.message_count} messages`}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
