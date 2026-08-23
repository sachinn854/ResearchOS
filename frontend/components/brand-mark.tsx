import { cn } from "@/lib/utils"

const SIZES = {
  sm: "size-7",
  md: "size-8",
  lg: "size-10",
  xl: "size-12",
} as const

/**
 * The mark: a rounded square with a crosshair-aperture cut in negative space.
 * Reads as a lens/instrument rather than a chat bubble — deliberate, since the
 * product is an evidence reader and not a messenger.
 */
export function BrandMark({
  size = "md",
  className,
}: {
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary grid shrink-0 place-items-center rounded-[28%] text-primary-foreground",
        SIZES[size],
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[58%]" fill="none" stroke="currentColor">
        {/* Aperture: a ring with four ticks on the axes, like a lens alignment
            target. Strokes, not fills, so it stays crisp at every size. */}
        <circle cx="12" cy="12" r="7.25" strokeWidth="2.5" />
        <path d="M12 1.75v4M12 18.25v4M1.75 12h4M18.25 12h4" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-title text-foreground", className)}>
      Research<span className="text-brand-deep">OS</span>
    </span>
  )
}
