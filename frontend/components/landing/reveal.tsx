"use client"

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react"

/**
 * Marks its children as `.reveal` and flips on `.is-visible` the first time
 * they cross into the viewport, then stops watching. One-shot on purpose — a
 * section that re-hides when you scroll past it and replays on the way back
 * reads as a slideshow, not a document.
 *
 * `as` picks the wrapper element (a `<div>` by default) so this can wrap a
 * grid item without introducing an extra block where inline flow matters.
 * `delay` staggers a group of siblings without each needing its own
 * IntersectionObserver.
 */
export function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  className,
  ...rest
}: {
  children?: ReactNode
  as?: ElementType
  delay?: number
  className?: string
} & React.ComponentPropsWithoutRef<"div">) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    // matchMedia, not the CSS media query alone: with motion reduced the
    // section should just be visible immediately rather than parked at
    // opacity 0 waiting on a scroll threshold that may never come on a short
    // page.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // One frame out rather than synchronously in the effect body: same
      // perceived result, no cascading render during the effect pass.
      const raf = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(raf)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag
      ref={ref}
      className={["reveal", visible ? "is-visible" : "", className].filter(Boolean).join(" ")}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
      {...rest}
    >
      {children}
    </Tag>
  )
}
