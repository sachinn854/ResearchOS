"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, Loader2 } from "lucide-react"

import { Notice } from "@/components/notice"
import { Exchange } from "@/components/exchange"
import { AppShell } from "@/components/app-shell"
import { Capabilities } from "@/components/landing/capabilities"
import { FeatureGrid } from "@/components/landing/feature-grid"
import { FinalCta } from "@/components/landing/final-cta"
import { HowItWorks } from "@/components/landing/how-it-works"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingHero } from "@/components/landing/landing-hero"
import { LandingNav } from "@/components/landing/landing-nav"
import {
  queryKBStream, fetchSessions, fetchSessionMessages,
  RateLimitError, type PipelineInfo, type SourceItem, type SessionItem,
} from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { ALL_DOMAINS } from "@/lib/domains"
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

function LandingPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <LandingNav />
      <main>
        <LandingHero />
        <FeatureGrid />
        <HowItWorks />
        <Capabilities />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}

export default function ChatPage() {
  const { user, loading: authLoading } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [domain, setDomain] = useState(ALL_DOMAINS)
  const [loading, setLoading] = useState(false)
  const [waitSeconds, setWaitSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [sessionsFailed, setSessionsFailed] = useState(false)
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null)
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollContainerRef = useRef<HTMLElement>(null)
  // Whether the reader is parked at the bottom. Auto-scroll only follows the
  // stream while this is true — otherwise every token would yank the page back
  // down and make it impossible to read an earlier answer while one streams.
  const pinnedToBottomRef = useRef(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) return
    const stored = localStorage.getItem("ros_session_id")
    const id = (stored && stored.startsWith(user.id + "_")) ? stored : `${user.id}_${randomId()}`
    localStorage.setItem("ros_session_id", id)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the session id is synced out of localStorage, an external store React cannot subscribe to
    setSessionId(id)
    loadSessions()
  }, [authLoading, user])

  // Follow the stream only while the reader is already at the bottom.
  useEffect(() => {
    if (pinnedToBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  function handleScroll() {
    const el = scrollContainerRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    pinnedToBottomRef.current = distance < 80
  }
  // Only owns the ticking; the counter itself is reset to 0 where loading
  // starts, so there is no synchronous setState in the effect body.
  useEffect(() => {
    if (!loading) return
    const t = setInterval(() => setWaitSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [loading])

  async function loadSessions() {
    try { setSessions(await fetchSessions()); setSessionsFailed(false) } catch { setSessionsFailed(true) }
  }
  async function loadSession(id: string) {
    if (streamAbortRef.current) { streamAbortRef.current.abort(); streamAbortRef.current = null }
    setError(null)
    try {
      const msgs = await fetchSessionMessages(id)
      setMessages(msgs.map(m => ({ role: m.role, content: m.content })))
      setSessionId(id); localStorage.setItem("ros_session_id", id)
    } catch { setError("That conversation could not be opened. Try another, or start a new one.") }
  }
  function startNewChat() {
    if (streamAbortRef.current) { streamAbortRef.current.abort(); streamAbortRef.current = null }
    const id = `${user!.id}_${randomId()}`
    localStorage.setItem("ros_session_id", id)
    setSessionId(id); setMessages([]); setError(null)
  }
  function autoGrow(el: HTMLTextAreaElement) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 176) + "px" }
  async function handleSubmit(query?: string) {
    const q = (query ?? input).trim()
    if (!q || loading) return
    setInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    setError(null)
    // A new question is an explicit jump to the bottom — re-engage the
    // auto-follow the user may have disabled by scrolling up earlier.
    pinnedToBottomRef.current = true
    setMessages(prev => [...prev, { role: "user", content: q }])
    setLoading(true)
    setWaitSeconds(0)
    setMessages(prev => [...prev, { role: "assistant", content: "" }])
    try {
      const abortCtrl = new AbortController()
      streamAbortRef.current = abortCtrl
      await queryKBStream(
        { query: q, domain: domain === ALL_DOMAINS ? null : domain, session_id: sessionId ?? undefined },
        (event) => {
          if (event.type === "token") setMessages(prev => {
            const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content: u[u.length - 1].content + event.content }; return u
          })
          else if (event.type === "sources") setMessages(prev => {
            const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], sources: event.sources, chunks_used: event.chunks_used }; return u
          })
          else if (event.type === "pipeline") setMessages(prev => {
            const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], pipeline: event }; return u
          })
          else if (event.type === "error") { setMessages(prev => prev.slice(0, -1)); setError(event.content) }
        }, abortCtrl.signal,
      )
      streamAbortRef.current = null; loadSessions()
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
      } else setError(err instanceof Error ? err.message : "The question did not go through. Try sending it again.")
    } finally { setLoading(false) }
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  if (authLoading) return <div className="bg-canvas h-dvh" />
  if (!user) return <LandingPage />

  const inputDisabled = rateLimitSeconds !== null
  const exchanges = pairMessages(messages)

  const composer = (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 pl-4 shadow-lift transition-colors focus-within:border-brand-edge">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => { setInput(e.target.value); autoGrow(e.target) }}
          onKeyDown={onKeyDown}
          placeholder={inputDisabled ? "Rate limit — wait for the countdown" : "Ask your library…"}
          rows={1}
          disabled={loading || inputDisabled}
          aria-label="Your question"
          className="max-h-44 min-h-[32px] flex-1 resize-none bg-transparent py-1.5 text-ui-lg text-foreground outline-none placeholder:text-ink-subtle"
        />
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={loading || !input.trim() || inputDisabled}
          aria-label="Ask"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-[background-color,box-shadow,transform] hover:shadow-[0_4px_14px_-4px_color-mix(in_oklab,var(--primary)_55%,transparent)] active:translate-y-px disabled:pointer-events-none disabled:bg-surface-raised disabled:text-ink-subtle"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </div>
      <p className="mt-2 pb-3 text-center text-meta text-ink-subtle">
        Every claim links back to its passage · Enter to send · Shift+Enter for a new line
      </p>
    </div>
  )

  return (
    <AppShell
      sessions={sessions}
      activeSessionId={sessionId}
      sessionsFailed={sessionsFailed}
      onRetry={loadSessions}
      onSelectSession={loadSession}
      onNewChat={startNewChat}
      domain={domain}
      onDomainChange={setDomain}
    >
      <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
        <main
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 sm:px-6"
        >
          <div className="mx-auto w-full max-w-3xl pb-10">
            {exchanges.length === 0 ? (
              <div className="animate-rise-in mx-auto flex min-h-[52vh] max-w-2xl flex-col items-center justify-center py-12 text-center">
                <p className="label-meta">ResearchOS / Ask</p>
                <h1 className="font-display mt-4 text-display font-semibold leading-[1.05] tracking-[-0.03em] text-foreground">
                  Ask across the papers you have.
                </h1>
                <p className="mx-auto mt-5 max-w-[52ch] text-ui-lg leading-relaxed text-muted-foreground">
                  Answers arrive as cited documents — every numbered marker opens the exact page and
                  passage behind it. Start with a suggestion.
                </p>
                <div className="mt-10 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                  {EXAMPLE_QUERIES.map((q, i) => (
                    <button
                      key={q}
                      onClick={() => handleSubmit(q)}
                      className="group rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-brand-edge"
                    >
                      <span className="label-meta block">Suggestion {String(i + 1).padStart(2, "0")}</span>
                      <span className="mt-1 block text-ui leading-snug text-muted-foreground group-hover:text-foreground">
                        {q}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="pt-10">
                {exchanges.map((ex, i) => (
                  <div key={i} className={cn("animate-rise-in", i > 0 && "mt-14 border-t border-border pt-12")}>
                    <Exchange
                      index={i + 1}
                      question={ex.question}
                      answer={ex.answer?.content ?? ""}
                      sources={ex.answer?.sources}
                      chunksUsed={ex.answer?.chunks_used}
                      pipeline={ex.answer?.pipeline}
                      isStreaming={loading && i === exchanges.length - 1}
                      waitSeconds={waitSeconds}
                    />
                  </div>
                ))}
                {error && <Notice className="mt-8">{error}</Notice>}
                <div ref={bottomRef} className="h-px" />
              </div>
            )}

            {rateLimitSeconds !== null && (
              <Notice tone="warning" className="mt-8">
                Two questions per 20 minutes — {Math.floor(rateLimitSeconds / 60)}:{String(rateLimitSeconds % 60).padStart(2, "0")}
              </Notice>
            )}
          </div>
        </main>

        {/* The composer docks to the bottom edge; the gradient above it fades a
            scrolling answer out gently instead of cutting it at a hard line. */}
        <footer className="relative shrink-0 px-5 sm:px-6">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-8 h-8"
            style={{ background: "linear-gradient(to top, var(--canvas), transparent)" }}
          />
          <div className="mx-auto w-full max-w-3xl pb-4">{composer}</div>
        </footer>
      </div>
    </AppShell>
  )
}

interface ExchangeItem { question: string; answer: Message | null }
function pairMessages(messages: Message[]): ExchangeItem[] {
  const out: ExchangeItem[] = []
  for (const m of messages) {
    if (m.role === "user") out.push({ question: m.content, answer: null })
    else if (out.length > 0 && out[out.length - 1].answer === null) out[out.length - 1].answer = m
    else out.push({ question: "", answer: m })
  }
  return out
}
