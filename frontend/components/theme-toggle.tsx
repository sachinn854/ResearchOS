"use client"

import { useSyncExternalStore } from "react"
import { Moon, Sun } from "lucide-react"

import { applyTheme, type Theme } from "@/lib/theme"
import { cn } from "@/lib/utils"

// The real theme lives in a class that a pre-paint script already put on <html>
// — the DOM is the store. Reading it through useSyncExternalStore means no
// hydration mismatch: the server renders the fallback (null → reserved space),
// and React re-syncs to the client snapshot right after hydration.
const listeners = new Set<() => void>()
function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}
function getClientSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}
function getServerSnapshot(): Theme | null {
  return null
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    applyTheme(next)
    // applyTheme writes the class directly; there is no external emitter, so
    // the store's subscribers are notified here.
    listeners.forEach(notify => notify())
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode"

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={cn(
        "grid size-9 place-items-center rounded-xl border border-transparent text-muted-foreground",
        "transition-colors duration-150 hover:bg-list hover:text-foreground",
        className,
      )}
    >
      {/* Reserves the icon's box before the theme is known, so the surrounding
          row does not shift by 16px on hydration. */}
      {theme === null ? (
        <span className="size-4" />
      ) : theme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </button>
  )
}
