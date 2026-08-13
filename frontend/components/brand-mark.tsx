import { cn } from "@/lib/utils"

const SIZES = {
  sm: "size-7",
  md: "size-9",
  lg: "size-11",
  xl: "size-14",
} as const

/**
 * A filled circle with a four-dot cluster.
 *
 * It had two tones, one of them an espresso badge for the icon rail. There is no
 * icon rail any more, and a `tone` prop with one value left is a prop that only
 * exists to be passed.
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
        "bg-primary text-primary-foreground grid shrink-0 place-items-center rounded-full",
        SIZES[size],
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[52%]" fill="currentColor">
        {/* Four dots on the diagonals — a cluster rather than a grid, so it reads
            as a mark and not as an app-launcher icon. */}
        <circle cx="8.4" cy="8.4" r="3.1" />
        <circle cx="15.6" cy="8.4" r="3.1" />
        <circle cx="8.4" cy="15.6" r="3.1" />
        <circle cx="15.6" cy="15.6" r="3.1" />
      </svg>
    </span>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-title text-foreground", className)}>
      ResearchOS
    </span>
  )
}
