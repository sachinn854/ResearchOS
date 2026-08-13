"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, Loader2 } from "lucide-react"

import { Exchange } from "@/components/exchange"
import { HistoryPanel } from "@/components/history-panel"
import { Notice } from "@/components/notice"
import { SourceList } from "@/components/source-list"
import { TopBar } from "@/components/top-bar"
import {
  queryKBStream, fetchSessions, fetchSessionMessages,
  RateLimitError, type PipelineInfo, type SourceItem, type SessionItem,
} from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { ALL_DOMAINS } from "@/lib/domains"
import { replaceTrailingEmoticon, suggestEmoji } from "@/lib/emoji"
import { cn } from "@/lib/utils"

const EXAMPLE_QUERIES = [
  "What are the main approaches to reducing hallucination in RAG systems?",
  "How does retrieval-augmented generation compare with fine-tuning?",
  "Explain the attention mechanism in transformers.",
  "What are the limitations of current LLM evaluation benchmarks?",
]

interface Message {
  role: "user" | "assistant"
  content: string
  sources?: SourceItem[]
  chunks_used?: number
  pipeline?: PipelineInfo
}

function randomId() {
  return Math.random().toString(36).slice(2, 10)
}

export default function ChatPage() {
  // user and the auth check come from the shared provider, which verified the
  // token against /auth/me rather than reading a cached object out of localStorage.
  const { user, loading: authLoading } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [domain, setDomain] = useState(ALL_DOMAINS)
  const [loading, setLoading] = useState(false)
  const [waitSeconds, setWaitSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionItem[]>([])
  // Distinguishes "this account has no conversations" from "the request for them
  // failed". Both used to render as an empty list, so a 500 from
  // /research/sessions was indistinguishable from an empty history.
  const [sessionsFailed, setSessionsFailed] = useState(false)
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Which passage is open, and which answer's evidence the rail is showing.
  // Both live here rather than inside an exchange, because a citation in the
  // prose and a card in the rail are two controls for one piece of state and
  // they sit in different components.
  const [openSource, setOpenSource] = useState<number | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Recomputed on every keystroke, which is cheap: eight regexes against one
  // short string, and it stops after three matches.
  const emojiHints = suggestEmoji(input)

  useEffect(() => {
    // Wait for the provider to finish checking the token. Redirecting while
    // authLoading is true would bounce every page refresh to /login, because
    // user is still null at that point even for a perfectly valid token.
    if (authLoading) return

    if (!user) { window.location.href = "/login"; return }

    // Session ids stay prefixed with the user id so a browser shared by two
    // people does not resume the other person's conversation. Ownership itself is
    // no longer inferred from this string — the backend stores a real user_id
    // column and filters on the token's user.
    const stored = localStorage.getItem("ros_session_id")
    const id = (stored && stored.startsWith(user.id + "_")) ? stored : `${user.id}_${randomId()}`
    localStorage.setItem("ros_session_id", id)
    setSessionId(id)
    loadSessions()
  }, [authLoading, user])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Count the seconds a query has been in flight. Nothing appears on screen
  // between pressing send and the first streamed token, and that gap is real work
  // — several searches over the papers, then verification before any text is let
  // out. Dots alone made people think the request had died.
  useEffect(() => {
    if (!loading) {
      setWaitSeconds(0)
      return
    }
    const timer = setInterval(() => setWaitSeconds(prev => prev + 1), 1000)
    return () => clearInterval(timer)
  }, [loading])

  async function loadSessions() {
    try {
      setSessions(await fetchSessions())
      setSessionsFailed(false)
    } catch {
      // Deliberately does not clear `sessions`: if a refresh fails we would
      // rather keep the list we already have than blank the column.
      setSessionsFailed(true)
    }
  }

  async function loadSession(id: string) {
    if (streamAbortRef.current) { streamAbortRef.current.abort(); streamAbortRef.current = null }
    setError(null); setHistoryOpen(false); setOpenSource(null); setFocusedIndex(null)
    try {
      const msgs = await fetchSessionMessages(id)
      setMessages(msgs.map(m => ({ role: m.role, content: m.content })))
      setSessionId(id)
      localStorage.setItem("ros_session_id", id)
    } catch {
      setError("That conversation could not be opened. Try another, or start a new one.")
    }
  }

  function startNewChat() {
    if (streamAbortRef.current) { streamAbortRef.current.abort(); streamAbortRef.current = null }
    const id = `${user!.id}_${randomId()}`
    localStorage.setItem("ros_session_id", id)
    setSessionId(id)
    setMessages([]); setError(null); setHistoryOpen(false); setOpenSource(null); setFocusedIndex(null)
  }

  /** Grows the textarea to fit its content, capped. Shared by typing and by the
   *  emoji rail, which also changes the value. */
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 176) + "px"
  }

  function appendEmoji(emoji: string) {
    const el = textareaRef.current
    setInput(prev => {
      const next = prev.endsWith(" ") || prev === "" ? prev + emoji : prev + " " + emoji
      // Focus back to the input so the rail never steals the caret — tapping a
      // reaction and then having to click the field again is the whole reason
      // emoji pickers feel clunky.
      if (el) window.requestAnimationFrame(() => { el.focus(); autoGrow(el) })
      return next
    })
  }

  async function handleSubmit(query?: string) {
    const q = (query ?? input).trim()
    if (!q || loading) return

    setInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    setError(null)
    // Hand the rail back to the newest answer. Without this, asking a follow-up
    // after opening a citation three answers up leaves the evidence column
    // showing that old answer's passages while a new one streams beside it.
    setFocusedIndex(null)
    setOpenSource(null)
    setMessages(prev => [...prev, { role: "user", content: q }])
    setLoading(true)
    setMessages(prev => [...prev, { role: "assistant", content: "" }])

    try {
      const abortCtrl = new AbortController()
      streamAbortRef.current = abortCtrl
      await queryKBStream(
        { query: q, domain: domain === ALL_DOMAINS ? null : domain, session_id: sessionId ?? undefined },
        (event) => {
          if (event.type === "token") {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: updated[updated.length - 1].content + event.content,
              }
              return updated
            })
          } else if (event.type === "sources") {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { ...updated[updated.length - 1], sources: event.sources, chunks_used: event.chunks_used }
              return updated
            })
          } else if (event.type === "pipeline") {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { ...updated[updated.length - 1], pipeline: event }
              return updated
            })
          } else if (event.type === "error") {
            setMessages(prev => prev.slice(0, -1))
            setError(event.content)
          }
        },
        abortCtrl.signal,
      )
      streamAbortRef.current = null
      loadSessions()
    } catch (err) {
      setMessages(prev => prev.slice(0, -1))
      if (err instanceof RateLimitError) {
        setRateLimitSeconds(err.retryAfter)
        if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current)
        rateLimitTimerRef.current = setInterval(() => {
          setRateLimitSeconds(prev => {
            if (prev === null || prev <= 1) { clearInterval(rateLimitTimerRef.current!); rateLimitTimerRef.current = null; return null }
            return prev - 1
          })
        }, 1000)
      } else {
        setError(err instanceof Error ? err.message : "The question did not go through. Try sending it again.")
      }
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  // Blank while the token is being verified, and also once we know there is no
  // user — the effect above is already redirecting, and rendering the app for a
  // split second first would flash a signed-in layout at someone who is not.
  if (authLoading || !user) {
    return <div className="bg-canvas h-dvh" />
  }

  const inputDisabled = rateLimitSeconds !== null

  const composer = (
    <>
      {/* Reads what is being typed and offers a couple of emoji for it. Hidden
          entirely when there is nothing to suggest, so it never occupies space it
          has not earned. */}
      {emojiHints.length > 0 && !inputDisabled && (
        <div className="mb-2 flex items-center gap-1.5">
          {emojiHints.map((e, i) => (
            <button
              key={e}
              type="button"
              onClick={() => appendEmoji(e)}
              aria-label={`Add ${e} to your question`}
              className="animate-emoji-pop bg-list grid size-9 place-items-center rounded-full border border-border text-lg transition-transform hover:scale-110 active:scale-95"
              style={{ animationDelay: `${i * 55}ms` }}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* The paper-plane glyph that used to sit on the left is gone: the send
          button on the right already says what this box does, and two send icons
          on one control is one of them decorating. */}
      <div className="bg-list flex items-end gap-2 rounded-xl border border-border py-2 pr-2 pl-4 transition-colors focus-within:border-brand-edge">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => {
            // Emoticon → emoji. Only ever rewrites the tail of the string, so the
            // caret cannot be yanked out from under someone editing earlier text.
            setInput(replaceTrailingEmoticon(e.target.value))
            autoGrow(e.target)
          }}
          onKeyDown={onKeyDown}
          placeholder={
            inputDisabled
              ? "Rate limit reached — the countdown above shows when you can ask again"
              : "Ask a question about your papers…"
          }
          rows={1}
          disabled={loading || inputDisabled}
          aria-label="Your question"
          className="flex-1 resize-none bg-transparent py-2 text-read text-foreground outline-none placeholder:text-ink-subtle disabled:text-muted-foreground"
          // Inline rather than utilities because the auto-grow handler above
          // writes style.height directly — keeping all three height values in one
          // place is what stops them contradicting.
          style={{ minHeight: "40px", maxHeight: "176px" }}
        />
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={loading || !input.trim()}
          aria-label="Send question"
          className="btn-primary size-9 shrink-0 rounded-lg p-0"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </div>
    </>
  )



  // The transcript is stored as the alternating list the API returns; the screen
  // is a list of exchanges. Pairing them here keeps that difference in one place
  // instead of threading "is the next message the answer to this one" through the
  // render.
  const exchanges = pairMessages(messages)
  const lastIndex = exchanges.length - 1

  // Which answer the evidence rail is showing. It follows the newest one until
  // you touch an older answer's citation, because during a stream that is the
  // one being read, and after it that is still the one being read.
  const railIndex = focusedIndex ?? lastIndex
  const railExchange = exchanges[railIndex]

  return (
    <div className="bg-canvas flex h-dvh flex-col">
      <TopBar
        active="chat"
        onOpenHistory={() => setHistoryOpen(true)}
        historyCount={sessions.length}
        domain={domain}
        onDomainChange={setDomain}
      />

      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={sessions}
        activeSessionId={sessionId}
        sessionsFailed={sessionsFailed}
        onRetry={loadSessions}
        onSelect={loadSession}
        onNewChat={startNewChat}
      />

      {/* The reading column and the evidence rail are one bounded group, centred
          together. Letting the rail sit against the window edge and the column
          float in the middle put four hundred pixels of nothing between a claim
          and the passage behind it — which is the one adjacency this whole screen
          exists to create. */}
      <div className="mx-auto flex min-h-0 w-full max-w-[1320px] flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-9 sm:px-8">
            <div className="mx-auto w-full max-w-[46rem] xl:mx-0">
              {exchanges.length === 0 ? (
                <div className="animate-exchange-in">
                  <h2 className="font-display text-display text-foreground">
                    Ask across the papers you have.
                  </h2>
                  <p className="mt-3 max-w-lg text-read text-muted-foreground">
                    Every answer names the passage it came from — with its page and a
                    relevance score you can open and read.
                  </p>

                  <p className="label-meta mt-12 mb-1">Try one of these</p>
                  {/* A ruled list, not a grid of cards. These are questions to
                      read, and four boxes of body text pretending to be buttons
                      was the most template-looking thing on the screen. */}
                  <ul className="border-t border-border">
                    {EXAMPLE_QUERIES.map(q => (
                      <li key={q} className="border-b border-border">
                        <button
                          onClick={() => handleSubmit(q)}
                          className="group flex w-full items-baseline gap-3 py-3.5 text-left text-ui-lg text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ArrowUp className="group-hover:text-brand-deep size-3.5 shrink-0 translate-y-px rotate-45 text-ink-subtle transition-colors" />
                          <span>{q}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                exchanges.map((ex, i) => (
                  <div
                    key={i}
                    onFocusCapture={() => setFocusedIndex(i)}
                    // A rule between exchanges rather than a gap. On a page of
                    // continuous prose the eye needs a line to know where one
                    // answer stops and the next question starts; whitespace alone
                    // reads as a paragraph break.
                    className={cn(
                      "animate-exchange-in",
                      i > 0 && "mt-12 border-t border-border pt-12",
                    )}
                  >
                    <Exchange
                      question={ex.question}
                      answer={ex.answer?.content ?? ""}
                      sources={ex.answer?.sources}
                      chunksUsed={ex.answer?.chunks_used}
                      pipeline={ex.answer?.pipeline}
                      isStreaming={loading && i === lastIndex}
                      waitSeconds={waitSeconds}
                      openSource={railIndex === i ? openSource : null}
                      onOpenSource={setOpenSource}
                      onFocus={() => setFocusedIndex(i)}
                    />
                  </div>
                ))
              )}

              {error && <Notice className="mt-8">{error}</Notice>}
              <div ref={bottomRef} className="h-px" />
            </div>
          </div>

          {rateLimitSeconds !== null && (
            <div className="shrink-0 px-5 sm:px-8">
              <Notice tone="warning" className="mx-auto w-full max-w-[46rem] xl:mx-0">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold">Two questions per 20 minutes</span>
                  <span className="text-muted-foreground">You can ask again in</span>
                  <span className="font-mono font-semibold">
                    {Math.floor(rateLimitSeconds / 60)}:{String(rateLimitSeconds % 60).padStart(2, "0")}
                  </span>
                </span>
              </Notice>
            </div>
          )}

          <div className="shrink-0 px-5 pt-3 pb-5 sm:px-8">
            <div className="mx-auto w-full max-w-[46rem] xl:mx-0">{composer}</div>
          </div>
        </div>

        {/* The second column is evidence, not navigation. It is the only thing on
            this screen worth a permanent band of the window, and it is what the
            two sidebars were taking up room that could have gone to. */}
        {/* Narrower than it was, and the group around it wider, which together
            move its left edge a good way right. A source card holds a title, a
            page and a score — it needed 336px only because it was set at reading
            size; at interface size 288px is more than it needs, and the room that
            frees goes to the margin between the answer and the evidence, which
            is what was missing. */}
        <aside
          aria-label="Evidence for the answer"
          className="bg-card hidden w-[18rem] shrink-0 overflow-y-auto border-l border-border px-5 py-9 xl:block"
        >
          {railExchange?.answer?.sources?.length ? (
            <SourceList
              sources={railExchange.answer.sources}
              chunksUsed={railExchange.answer.chunks_used}
              pipeline={railExchange.answer.pipeline}
              openIndex={openSource}
              onOpen={setOpenSource}
            />
          ) : (
            <div>
              <p className="label-meta">Evidence</p>
              <p className="mt-2 text-ui text-muted-foreground">
                The passages behind an answer appear here, numbered to match the
                markers in its text.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

interface ExchangeItem {
  question: string
  answer: Message | null
}

/** Folds the alternating message list into question/answer pairs.
 *
 *  An assistant message with no question before it is kept with an empty question
 *  rather than dropped: a conversation loaded from history could in principle
 *  start with one, and losing an answer is worse than showing one without its
 *  heading. */
function pairMessages(messages: Message[]): ExchangeItem[] {
  const out: ExchangeItem[] = []
  for (const m of messages) {
    if (m.role === "user") out.push({ question: m.content, answer: null })
    else if (out.length > 0 && out[out.length - 1].answer === null) out[out.length - 1].answer = m
    else out.push({ question: "", answer: m })
  }
  return out
}
