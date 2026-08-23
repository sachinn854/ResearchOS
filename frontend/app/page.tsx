"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Menu, Send } from "lucide-react"

import { Notice } from "@/components/notice"
import { Exchange } from "@/components/exchange"
import { AppSidebar } from "@/components/app-sidebar"
import { BrandMark } from "@/components/brand-mark"
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) return
    const stored = localStorage.getItem("ros_session_id")
    const id = (stored && stored.startsWith(user.id + "_")) ? stored : `${user.id}_${randomId()}`
    localStorage.setItem("ros_session_id", id)
    setSessionId(id)
    loadSessions()
  }, [authLoading, user])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])
  useEffect(() => {
    if (!loading) { setWaitSeconds(0); return }
    const t = setInterval(() => setWaitSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [loading])

  async function loadSessions() {
    try { setSessions(await fetchSessions()); setSessionsFailed(false) } catch { setSessionsFailed(true) }
  }
  async function loadSession(id: string) {
    if (streamAbortRef.current) { streamAbortRef.current.abort(); streamAbortRef.current = null }
    setError(null); setSidebarOpen(false)
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
    setSessionId(id); setMessages([]); setError(null); setSidebarOpen(false)
  }
  function autoGrow(el: HTMLTextAreaElement) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 176) + "px" }
  async function handleSubmit(query?: string) {
    const q = (query ?? input).trim()
    if (!q || loading) return
    setInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    setError(null)
    setMessages(prev => [...prev, { role: "user", content: q }])
    setLoading(true)
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
  const lastIndex = exchanges.length - 1

  const composer = (
    <>
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-lift transition-colors focus-within:border-brand-edge">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => { setInput(e.target.value); autoGrow(e.target) }}
          onKeyDown={onKeyDown}
          placeholder={inputDisabled ? "Rate limit — wait for the countdown" : "Ask ResearchOS…"}
          rows={1}
          disabled={loading || inputDisabled}
          aria-label="Your question"
          className="max-h-44 min-h-[28px] flex-1 resize-none bg-transparent text-ui-lg leading-6 text-foreground outline-none placeholder:text-ink-subtle"
        />
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={loading || !input.trim() || inputDisabled}
          aria-label="Ask"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors active:translate-y-px disabled:pointer-events-none disabled:bg-surface-raised disabled:text-ink-subtle"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </div>
      <p className="mt-2 text-center text-meta text-ink-subtle">
        Answers are checked against your library — open a citation to read the exact passage.
      </p>
    </>
  )

  return (
    <div className="flex min-h-dvh bg-canvas">
      <AppSidebar
        sessions={sessions}
        activeSessionId={sessionId}
        sessionsFailed={sessionsFailed}
        onRetry={loadSessions}
        onSelect={loadSession}
        onNewChat={startNewChat}
        domain={domain}
        onDomainChange={setDomain}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Only the sidebar toggle below lg — brand, history, scope and the
            account all live in the sidebar now, so there is nothing else this
            row needs to carry. */}
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border bg-canvas/80 px-4 backdrop-blur-[14px] lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground"
          >
            <Menu className="size-4" />
          </button>
          <BrandMark size="sm" />
          <span className="font-display text-title-sm text-foreground">ResearchOS</span>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            {exchanges.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-lift sm:px-10 sm:py-14">
                <p className="label-meta">Ask your library</p>
                <p className="mx-auto mt-3 max-w-[42ch] font-serif text-title-lg font-semibold leading-tight text-foreground">
                  Ask across the papers you have.
                </p>
                <p className="mx-auto mt-3 max-w-[56ch] text-ui text-muted-foreground">
                  Every answer cites the passage it came from — page, score and the quoted text, one click
                  away. Start with a suggestion below.
                </p>
                <div className="mx-auto mt-6 grid max-w-xl grid-cols-1 gap-2 text-left sm:grid-cols-2">
                  {EXAMPLE_QUERIES.map(q => (
                    <button
                      key={q}
                      onClick={() => handleSubmit(q)}
                      className="rounded-xl border border-border bg-list px-4 py-3 text-left text-ui text-muted-foreground transition-colors hover:border-brand-edge hover:bg-card hover:text-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                {exchanges.map((ex, i) => (
                  <div key={i} className={cn("animate-exchange-in", i > 0 && "mt-12 border-t border-border pt-10")}>
                    <Exchange
                      question={ex.question}
                      answer={ex.answer?.content ?? ""}
                      sources={ex.answer?.sources}
                      chunksUsed={ex.answer?.chunks_used}
                      pipeline={ex.answer?.pipeline}
                      isStreaming={loading && i === lastIndex}
                      waitSeconds={waitSeconds}
                    />
                  </div>
                ))}
                {error && <Notice className="mt-6">{error}</Notice>}
                <div ref={bottomRef} className="h-px" />
              </div>
            )}

            {rateLimitSeconds !== null && (
              <Notice tone="warning" className="mt-6">
                Two questions per 20 minutes — {Math.floor(rateLimitSeconds / 60)}:{String(rateLimitSeconds % 60).padStart(2, "0")}
              </Notice>
            )}
          </div>
        </main>

        <div className="border-t border-border bg-card px-5 py-4 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">{composer}</div>
        </div>
      </div>
    </div>
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
