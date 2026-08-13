"use client"

import { Children, useMemo, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { SourceList } from "@/components/source-list"
import type { PipelineInfo, SourceItem } from "@/lib/api"
import { cn } from "@/lib/utils"

/** `[6]` and nothing else. Two digits at most, because a three-digit run is far
 *  more likely to be a year or a figure number than a citation. */
const CITATION = /\[(\d{1,2})\]/g

/**
 * One question and the answer to it.
 *
 * A question is a heading and an answer is a document — not two speech bubbles
 * with an avatar between them. What a person does here is ask something and then
 * read a cited piece of writing about it, and a bubble is a container for a
 * remark.
 *
 * The evidence lives in the rail beside this on a wide screen, and folds in
 * underneath when there is no room for a rail. Both render the same component
 * off the same state, so the narrow layout cannot drift from the wide one.
 */
export function Exchange({
  question,
  answer,
  sources,
  chunksUsed,
  pipeline,
  isStreaming,
  waitSeconds,
  openSource,
  onOpenSource,
  onFocus,
}: {
  question: string
  answer: string
  sources?: SourceItem[]
  chunksUsed?: number
  pipeline?: PipelineInfo
  isStreaming: boolean
  waitSeconds: number
  /** 1-based index of the open passage, or null. Owned by the page so the rail
   *  and the inline list stay in step. */
  openSource: number | null
  onOpenSource: (n: number | null) => void
  /** Called when something in this exchange is used, so the rail can switch to
   *  showing this answer's evidence rather than the newest one's. */
  onFocus: () => void
}) {
  const cited = sources ?? []

  // Rebuilt only when the number of sources changes, not on every streamed
  // token: a new object here would hand react-markdown a new component map on
  // each token and force it to remount the whole answer.
  const components = useMemo(
    () => markdownComponents(cited.length, n => { onFocus(); onOpenSource(n) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cited.length],
  )

  return (
    <article>
      <h2 className="q-heading">{question}</h2>

      {answer ? (
        <div
          // The answer arrives a token at a time. aria-live alone would make a
          // screen reader interrupt itself on each one; aria-busy tells it to
          // hold and read the region once, when the stream finishes.
          aria-live="polite"
          aria-atomic="false"
          aria-busy={isStreaming}
          className={cn(
            "prose-answer prose mt-5 max-w-none",
            "prose-a:font-semibold prose-a:no-underline hover:prose-a:underline",
            "prose-pre:rounded-lg prose-pre:text-data",
            "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
            isStreaming && "stream-caret",
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {answer}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="mt-5 max-w-md" role="status">
          <div className="working-bar" />
          <p className="mt-3 text-ui text-muted-foreground">
            Searching your papers
            {waitSeconds > 2 && (
              <span className="ml-2 font-mono text-meta text-ink-subtle">{waitSeconds}s</span>
            )}
          </p>
          {isStreaming && (
            <p className="mt-1.5 text-ui text-ink-subtle">
              Usually 30–60 seconds. The question is matched against the full text of
              every paper, and the answer is checked against its own sources before any
              of it appears.
            </p>
          )}
        </div>
      )}

      {/* Below xl there is no rail, so the evidence folds in here instead. */}
      <SourceList
        sources={cited}
        chunksUsed={chunksUsed}
        pipeline={pipeline}
        openIndex={openSource}
        onOpen={n => { onFocus(); onOpenSource(n) }}
        className="mt-8 border-t border-border pt-5 xl:hidden"
      />
    </article>
  )
}

/**
 * Overrides for the markdown elements that can contain a citation marker.
 *
 * Only the elements that hold text are listed, and none of them recurses: a
 * `[1]` inside bold text is caught by the `strong` override rather than by `p`
 * walking into its children. That keeps this a flat pass over strings instead of
 * a tree rewrite, which matters because it runs on every streamed token.
 */
function markdownComponents(sourceCount: number, onCite: (n: number) => void) {
  // Written out per tag rather than generated from a list of tag names: a
  // generic `<Tag>` helper cannot be typed, because TypeScript has to prove the
  // children are valid for *every* intrinsic element the parameter could hold.
  const link = (children: ReactNode) => linkCitations(children, sourceCount, onCite)
  type P = { children?: ReactNode }

  return {
    p: ({ children }: P) => <p>{link(children)}</p>,
    li: ({ children }: P) => <li>{link(children)}</li>,
    td: ({ children }: P) => <td>{link(children)}</td>,
    th: ({ children }: P) => <th>{link(children)}</th>,
    strong: ({ children }: P) => <strong>{link(children)}</strong>,
    em: ({ children }: P) => <em>{link(children)}</em>,
    h1: ({ children }: P) => <h1>{link(children)}</h1>,
    h2: ({ children }: P) => <h2>{link(children)}</h2>,
    h3: ({ children }: P) => <h3>{link(children)}</h3>,
  }
}

/**
 * Replaces every resolvable `[n]` in a run of text with a control.
 *
 * The model already writes these markers — they were rendered as literal
 * brackets, which meant the one place an answer told you where a claim came from
 * was the one place you could not click.
 */
function linkCitations(children: ReactNode, sourceCount: number, onCite: (n: number) => void) {
  return Children.map(children, child => {
    if (typeof child !== "string") return child

    const parts: ReactNode[] = []
    let cursor = 0

    for (const match of child.matchAll(CITATION)) {
      const n = Number(match[1])
      // A number with no passage behind it stays as written. The model
      // occasionally cites past the end of what it was given, and a control that
      // opens nothing is worse than leaving the brackets alone.
      if (n < 1 || n > sourceCount || match.index === undefined) continue

      if (match.index > cursor) parts.push(child.slice(cursor, match.index))
      parts.push(
        <button
          key={`${match.index}-${n}`}
          type="button"
          onClick={() => onCite(n)}
          aria-label={`Show source ${n}`}
          className="cite-mark"
        >
          {n}
        </button>,
      )
      cursor = match.index + match[0].length
    }

    if (parts.length === 0) return child
    if (cursor < child.length) parts.push(child.slice(cursor))
    return parts
  })
}
