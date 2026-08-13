"use client"

import type { PipelineInfo, SourceItem } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * The passages an answer was built from, numbered to match the markers in its
 * text.
 *
 * The open card is controlled from outside rather than held here, because two
 * different things open one: clicking the card, and clicking the `[3]` in the
 * middle of a sentence three hundred pixels away. Owning that state here would
 * mean the prose could not reach it.
 */
export function SourceList({
  sources,
  chunksUsed,
  pipeline,
  openIndex,
  onOpen,
  className,
}: {
  sources: SourceItem[]
  chunksUsed?: number
  pipeline?: PipelineInfo
  /** 1-based, to match the citation markers. */
  openIndex: number | null
  onOpen: (n: number | null) => void
  className?: string
}) {
  if (sources.length === 0) return null

  const retrieval = pipeline?.methods.length
    ? `${pipeline.methods.join(" + ")}${pipeline.reranked ? " + RRF" : ""}`
    : null

  return (
    <div className={className}>
      <p className="label-meta">Evidence</p>
      <p className="mt-1 text-ui text-muted-foreground">
        {chunksUsed ?? sources.length} passages
        {retrieval && <span className="text-ink-subtle"> · {retrieval}</span>}
      </p>

      <ul className="mt-3 space-y-1.5">
        {sources.map((s, i) => {
          const n = i + 1
          const isOpen = openIndex === n
          return (
            <li key={`${s.document_id}-${s.chunk_index}`}>
              <button
                type="button"
                id={`source-${n}`}
                onClick={() => onOpen(isOpen ? null : n)}
                aria-expanded={isOpen}
                className={cn(
                  "flex w-full gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  isOpen
                    ? "border-brand-edge bg-brand-soft"
                    : "hover:bg-surface-raised border-transparent",
                )}
              >
                <span className="source-index mt-px">{n}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui font-semibold text-foreground">
                    {s.title ?? "Unknown source"}
                  </span>
                  <span className="mt-0.5 block font-mono text-meta text-ink-subtle">
                    {s.page_number != null && `p.${s.page_number} · `}
                    {s.score.toFixed(3)}
                  </span>
                </span>
              </button>

              {/* The quote opens under its own card rather than in a shared slot
                  at the bottom, so the thing you clicked does not move. */}
              {isOpen && s.text && <p className="passage mt-1.5">{s.text}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
