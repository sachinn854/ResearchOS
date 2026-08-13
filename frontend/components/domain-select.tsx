"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ALL_DOMAINS, DOMAINS } from "@/lib/domains"
import { cn } from "@/lib/utils"

/**
 * Replaces the native <select> both pages were using. A native dropdown renders
 * with the operating system's own colours — on Windows that is a white popup
 * with black text, which looked broken against the dark theme and could not be
 * styled at all. This one is a Radix listbox, so it inherits our tokens.
 */
export function DomainSelect({
  value,
  onChange,
  includeAll = false,
  disabled = false,
  className,
  id,
}: {
  value: string
  onChange: (value: string) => void
  includeAll?: boolean
  disabled?: boolean
  className?: string
  /** Set this when a visible <label htmlFor> points at the control. Without it
   *  the label is attached to nothing and only the aria-label below is read. */
  id?: string
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label={id ? undefined : "Domain"}
        className={cn(
          "h-10 gap-2 rounded-lg border-border bg-card px-3.5 text-ui-lg text-foreground",
          "transition-colors hover:border-border-strong data-placeholder:text-ink-subtle",
          className,
        )}
      >
        <SelectValue placeholder="Domain" />
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="min-w-52">
        {includeAll && <SelectItem value={ALL_DOMAINS}>All domains</SelectItem>}
        {DOMAINS.map(d => (
          <SelectItem key={d.value} value={d.value}>
            {d.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
