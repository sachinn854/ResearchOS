import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

const TONES = {
  error: { cls: "border-destructive/30 bg-destructive/10 text-destructive", Icon: CircleAlert },
  warning: { cls: "border-warning/30 bg-warning/10 text-warning", Icon: TriangleAlert },
  success: { cls: "border-success/30 bg-success/10 text-success", Icon: CircleCheck },
  info: { cls: "border-border bg-list text-muted-foreground", Icon: Info },
} as const

/** Inline message block. The same four-line markup appeared on every page, each
 *  copy with its own hardcoded rgba() values. */
export function Notice({
  tone = "error",
  children,
  className,
}: {
  tone?: keyof typeof TONES
  children: React.ReactNode
  className?: string
}) {
  const { cls, Icon } = TONES[tone]
  return (
    <div
      // Errors interrupt (assertive); the quieter tones announce politely when
      // the reader is idle. Both matter here because a Notice is how an ingest
      // reports "queued → running → completed" while the user waits, and how a
      // failed stream explains itself — neither is visible to a screen reader
      // without a live region.
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-2.5 rounded-xl border px-4 py-3.5 text-ui", cls, className)}
    >
      <Icon className="mt-px size-4 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}
