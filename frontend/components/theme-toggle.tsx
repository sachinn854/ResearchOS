"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

import { applyTheme, resolveTheme, type Theme } from "@/lib/theme"
import { cn } from "@/lib/utils"

export function ThemeToggle({ className }: { className?: string }) {
  // Starts null rather than "light". The real theme lives in a class that a
  // pre-paint script already put on <html>, and the server has no way to know
  // what that was — so guessing here would render the wrong icon for a moment
  // and trip a hydration mismatch.
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => setTheme(resolveTheme()), [])

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    applyTheme(next)
    setTheme(next)
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
