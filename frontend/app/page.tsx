"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  queryKBStream, fetchSessions, fetchSessionMessages,
  RateLimitError, type PipelineInfo, type SourceItem, type SessionItem,
} from "@/lib/api"
import { useAuth } from "@/lib/auth-context"

const DOMAINS = [
  { value: "all", label: "All Domains", icon: "◈" },
  { value: "ml", label: "ML / AI", icon: "⬡" },
  { value: "dl", label: "Deep Learning", icon: "◉" },
  { value: "cs", label: "Computer Science", icon: "⬢" },
  { value: "physics", label: "Physics", icon: "◎" },
  { value: "bio", label: "Biology", icon: "◌" },
  { value: "finance", label: "Finance", icon: "◆" },
  { value: "math", label: "Mathematics", icon: "△" },
]

const EXAMPLE_QUERIES = [
  "What are the main approaches to reduce hallucinations in RAG systems?",
  "How does retrieval augmented generation compare to fine-tuning?",
  "Explain attention mechanisms in transformers.",
  "Limitations of current LLM evaluation benchmarks?",
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

function timeAgo(isoStr: string | null): string {
  if (!isoStr) return ""
  const diff = Date.now() - new Date(isoStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function ChatPage() {
  // user and the auth check now come from the shared provider, which verified
  // the token against /auth/me instead of reading a cached object out of
  // localStorage.
  const { user, loading: authLoading, logout } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [domain, setDomain] = useState("all")
  const [loading, setLoading] = useState(false)
  const [waitSeconds, setWaitSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [showSources, setShowSources] = useState<Record<number, boolean>>({})
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null)
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null)
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Wait for the provider to finish checking the token. Redirecting while
    // authLoading is true would bounce every page refresh to /login, because
    // user is still null at that point even for a perfectly valid token.
    if (authLoading) return

    if (!user) { window.location.href = "/login"; return }

    // Session ids are still prefixed with the user id so that a browser shared
    // by two people does not resume the other person's chat. Ownership itself is
    // no longer inferred from this string — the backend stores a real user_id
    // column and filters on the token's user.
    const stored = localStorage.getItem("ros_session_id")
    const id = (stored && stored.startsWith(user.id + "_")) ? stored : `${user.id}_${randomId()}`
    localStorage.setItem("ros_session_id", id)
    setSessionId(id)
    fetchSessions().then(setSessions).catch(() => {})
  }, [authLoading, user])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Count the seconds a query has been in flight. Nothing appears on screen
  // between pressing send and the first streamed token, and that gap is real
  // work — several searches over the papers, then verification passes before any
  // text is allowed out. Bouncing dots alone left people wondering whether the
  // request had died, so the wait is labelled and counted instead.
  useEffect(() => {
    if (!loading) {
      setWaitSeconds(0)
      return
    }
    const timer = setInterval(() => setWaitSeconds(prev => prev + 1), 1000)
    return () => clearInterval(timer)
  }, [loading])

  async function refreshSessions() {
    if (!user) return
    try { setSessions(await fetchSessions()) } catch { /* non-critical */ }
  }

  async function loadSession(id: string) {
    if (streamAbortRef.current) { streamAbortRef.current.abort(); streamAbortRef.current = null }
    setError(null); setShowSources({}); setExpandedChunk(null)
    try {
      const msgs = await fetchSessionMessages(id)
      setMessages(msgs.map(m => ({ role: m.role, content: m.content })))
      setSessionId(id)
      localStorage.setItem("ros_session_id", id)
    } catch {
      setError("Failed to load session")
    }
  }

  function startNewChat() {
    if (streamAbortRef.current) { streamAbortRef.current.abort(); streamAbortRef.current = null }
    const id = `${user!.id}_${randomId()}`
    localStorage.setItem("ros_session_id", id)
    setSessionId(id)
    setMessages([]); setError(null); setShowSources({}); setExpandedChunk(null)
  }

  function handleLogout() {
    if (streamAbortRef.current) { streamAbortRef.current.abort() }
    logout()
    window.location.href = "/login"
  }

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
        { query: q, domain: domain === "all" ? null : domain, session_id: sessionId ?? undefined },
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
      refreshSessions()
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
        setError(err instanceof Error ? err.message : "Something went wrong")
      }
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  function toggleSources(idx: number) {
    setShowSources(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  // Blank screen while the token is being verified, and also once we know there
  // is no user — in that case the effect above is already redirecting, and
  // rendering the chat UI for a split second first would flash a signed-in
  // layout at someone who is not signed in.
  if (authLoading || !user) {
    return <div className="h-screen" style={{ background: "var(--background)" }} />
  }

  return (
    <div className="flex h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>

      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col" style={{ background: "var(--sidebar)", borderRight: "1px solid var(--sidebar-border)" }}>

        {/* Logo + New Chat */}
        <div className="px-4 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-sm font-bold"
              style={{ background: "linear-gradient(135deg, #cc6b45 0%, #e8845a 100%)" }}>
              R
            </div>
            <span className="font-semibold text-[14px]" style={{ color: "var(--foreground)" }}>ResearchOS</span>
          </div>
          <button
            onClick={startNewChat}
            title="New Chat"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all text-base leading-none"
            style={{ color: "var(--muted-foreground)", border: "1px solid var(--border)" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(204,107,69,0.15)"; el.style.color = "#e8845a"; el.style.borderColor = "rgba(204,107,69,0.4)" }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = ""; el.style.color = "var(--muted-foreground)"; el.style.borderColor = "var(--border)" }}
          >
            +
          </button>
        </div>

        {/* Chat history */}
        <div className="flex-1 overflow-y-auto py-3">
          {sessions.length === 0 ? (
            <p className="px-4 text-xs" style={{ color: "var(--muted-foreground)" }}>No chats yet</p>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest px-4 mb-2" style={{ color: "var(--muted-foreground)" }}>
                Recent
              </p>
              <div className="flex flex-col gap-0.5 px-2">
                {sessions.map(s => {
                  const active = s.session_id === sessionId
                  return (
                    <button
                      key={s.session_id}
                      onClick={() => loadSession(s.session_id)}
                      className="text-left px-3 py-2.5 rounded-xl text-xs transition-all duration-150 w-full"
                      style={active ? {
                        background: "rgba(204,107,69,0.15)",
                        border: "1px solid rgba(204,107,69,0.2)",
                      } : { border: "1px solid transparent" }}
                      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)" }}
                      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "" }}
                    >
                      <p className="truncate leading-tight font-medium" style={{ color: active ? "#e8845a" : "var(--foreground)" }}>
                        {s.preview || "Empty chat"}
                      </p>
                      <p className="mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                        {timeAgo(s.last_at)}
                      </p>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Bottom: upload + user + logout */}
        <div className="px-3 pb-4 pt-3 space-y-1" style={{ borderTop: "1px solid var(--sidebar-border)" }}>
          <Link href="/ingest" className="block">
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all duration-150"
              style={{ color: "var(--sidebar-foreground)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)" }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "" }}
            >
              <span className="text-base leading-none" style={{ color: "#e8845a" }}>↑</span>
              Upload Document
            </button>
          </Link>

          {/* User row */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl mt-1" style={{ background: "rgba(204,107,69,0.06)", border: "1px solid rgba(204,107,69,0.1)" }}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
              style={{ background: "linear-gradient(135deg, #cc6b45, #e8845a)" }}>
              {user?.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: "var(--foreground)" }}>{user?.name}</p>
              <p className="text-[10px] truncate" style={{ color: "var(--muted-foreground)" }}>{user?.email}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all"
            style={{ color: "var(--muted-foreground)" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(248,113,113,0.08)"; el.style.color = "#f87171" }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = ""; el.style.color = "var(--muted-foreground)" }}
          >
            <span className="text-sm leading-none">→</span>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <div className="shrink-0 h-14 flex items-center px-4 gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <select
            value={domain}
            onChange={e => setDomain(e.target.value)}
            className="text-sm rounded-xl px-3 py-1.5 outline-none cursor-pointer"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
          >
            {DOMAINS.map(d => (
              <option key={d.value} value={d.value}>{d.icon} {d.label}</option>
            ))}
          </select>
          {sessionId && (
            <span className="ml-auto text-xs font-mono opacity-30" style={{ color: "var(--muted-foreground)" }}>
              #{sessionId.slice(-8)}
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[55vh] text-center select-none">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 text-2xl font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #cc6b45 0%, #e8845a 100%)", boxShadow: "0 8px 40px rgba(204,107,69,0.3)" }}>
                  R
                </div>
                <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--foreground)" }}>
                  What do you want to research?
                </h1>
                <p className="text-base mb-10 max-w-md leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                  Ask anything. The system retrieves, synthesizes, and cites sources — with web fallback when your KB is empty.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
                  {EXAMPLE_QUERIES.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleSubmit(q)}
                      className="text-left p-4 rounded-xl text-sm leading-relaxed transition-all duration-150"
                      style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--sidebar-foreground)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(204,107,69,0.4)"; (e.currentTarget as HTMLElement).style.color = "var(--foreground)" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--sidebar-foreground)" }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={`${msg.role}-${i}-${msg.content.slice(0, 12)}`}>
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-tr-sm text-base leading-relaxed text-white"
                      style={{ background: "linear-gradient(135deg, #cc6b45 0%, #e8845a 100%)" }}>
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0"
                        style={{ background: "linear-gradient(135deg, #cc6b45 0%, #e8845a 100%)" }}>
                        AI
                      </div>
                      <span className="text-sm font-medium" style={{ color: "var(--muted-foreground)" }}>ResearchOS</span>
                    </div>

                    {msg.content ? (
                      <div className="pl-10">
                        <div className="prose prose-invert max-w-none
                          prose-headings:font-semibold prose-headings:tracking-tight
                          prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base
                          prose-h1:mt-6 prose-h2:mt-5 prose-h3:mt-4
                          prose-p:text-base prose-p:leading-7
                          prose-strong:font-semibold
                          prose-ul:text-base prose-ol:text-base prose-li:leading-7
                          prose-code:text-sm prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md
                          prose-pre:rounded-xl prose-pre:text-sm
                          prose-blockquote:text-base
                          prose-a:no-underline hover:prose-a:underline
                          prose-hr:my-6
                          [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                          style={{
                            "--tw-prose-body": "var(--foreground)",
                            "--tw-prose-headings": "var(--foreground)",
                            "--tw-prose-strong": "var(--foreground)",
                            "--tw-prose-bullets": "var(--muted-foreground)",
                            "--tw-prose-counters": "var(--muted-foreground)",
                            "--tw-prose-links": "#e8845a",
                            "--tw-prose-code": "#f0c4a8",
                            "--tw-prose-pre-bg": "var(--card)",
                            "--tw-prose-pre-code": "#c9d1d9",
                            "--tw-prose-quotes": "var(--muted-foreground)",
                            "--tw-prose-quote-borders": "#cc6b45",
                            "--tw-prose-hr": "var(--border)",
                          } as React.CSSProperties}
                        >
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <div className="pl-10 space-y-2.5">
                        <div className="flex gap-1.5 items-center h-8">
                          {[0, 150, 300].map(delay => (
                            <span key={delay}
                              className="w-2 h-2 rounded-full animate-bounce"
                              style={{ background: "#cc6b45", animationDelay: `${delay}ms` }}
                            />
                          ))}
                          <span className="ml-2.5 text-sm" style={{ color: "var(--muted-foreground)" }}>
                            Working through the papers
                            {/* Hidden for the first couple of seconds — a counter that
                                flashes "1s" on a fast answer just looks twitchy. */}
                            {waitSeconds > 2 && (
                              <span className="font-mono ml-1.5 opacity-70">{waitSeconds}s</span>
                            )}
                          </span>
                        </div>

                        {/* Only while this query is actually running, and only on the
                            last message — an older empty message should not claim to
                            be in progress. */}
                        {loading && i === messages.length - 1 && (
                          <p className="text-xs leading-relaxed max-w-lg" style={{ color: "var(--muted-foreground)" }}>
                            This usually takes 30–60 seconds. Your question is searched across the
                            full text of every paper, and the answer is checked against its own
                            sources before any of it is shown — so it is slower than a plain chatbot,
                            but the citations can be trusted.
                          </p>
                        )}
                      </div>
                    )}

                    {msg.pipeline && (
                      <div className="pl-10 flex flex-wrap gap-2 pt-1">
                        {msg.pipeline.methods.map(m => (
                          <span key={m} className="text-xs px-2.5 py-1 rounded-full font-medium"
                            style={{ background: "rgba(204,107,69,0.08)", color: "#e8845a", border: "1px solid rgba(204,107,69,0.15)" }}>
                            {m}
                          </span>
                        ))}
                        {msg.pipeline.reranked && (
                          <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                            style={{ background: "rgba(204,107,69,0.08)", color: "#e8845a", border: "1px solid rgba(204,107,69,0.15)" }}>
                            RRF Fusion
                          </span>
                        )}
                      </div>
                    )}

                    {msg.sources && msg.sources.length > 0 && (
                      <div className="pl-10 pt-1">
                        <button
                          onClick={() => toggleSources(i)}
                          className="flex items-center gap-2 text-sm mb-3 transition-colors"
                          style={{ color: "var(--muted-foreground)" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#e8845a" }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--muted-foreground)" }}
                        >
                          <span className="text-xs">{showSources[i] ? "▾" : "▸"}</span>
                          <span>{msg.chunks_used} chunks · {msg.sources.length} sources</span>
                        </button>

                        {showSources[i] && (
                          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                            {msg.sources.map((s, si) => {
                              const chunkKey = `${i}-${si}`
                              const isExpanded = expandedChunk === chunkKey
                              return (
                                <div key={si} style={{ borderTop: si > 0 ? "1px solid var(--border)" : undefined }}>
                                  <div
                                    className="flex items-center gap-3 px-4 py-3 text-sm cursor-pointer transition-all"
                                    style={{ background: isExpanded ? "rgba(204,107,69,0.06)" : si % 2 === 0 ? "var(--card)" : "transparent" }}
                                    onClick={() => setExpandedChunk(isExpanded ? null : chunkKey)}
                                  >
                                    <span className="font-mono text-xs shrink-0 w-7 text-center px-1 py-0.5 rounded"
                                      style={{ background: "rgba(204,107,69,0.15)", color: "#e8845a" }}>
                                      [{si + 1}]
                                    </span>
                                    <span className="flex-1 truncate font-medium" style={{ color: "var(--foreground)" }}>
                                      {s.title ?? "Unknown Source"}
                                    </span>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {s.page_number != null && (
                                        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>p.{s.page_number}</span>
                                      )}
                                      <span className="text-xs font-mono px-2 py-0.5 rounded"
                                        style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                                        {s.score.toFixed(3)}
                                      </span>
                                      <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                                        {isExpanded ? "▴" : "▾"}
                                      </span>
                                    </div>
                                  </div>
                                  {isExpanded && s.text && (
                                    <div className="px-4 py-4"
                                      style={{
                                        background: "var(--muted)",
                                        borderTop: "1px solid var(--border)",
                                        color: "var(--sidebar-foreground)",
                                        fontFamily: "var(--font-geist-mono), monospace",
                                        fontSize: "13px",
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                        lineHeight: 1.6,
                                      }}>
                                      {s.text}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {error && (
              <div className="rounded-xl px-4 py-3.5 text-sm"
                style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Rate limit banner */}
        {rateLimitSeconds !== null && (
          <div className="shrink-0 mx-4 mt-3 px-4 py-3 rounded-xl flex items-center gap-3 text-sm"
            style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}>
            <div>
              <span style={{ color: "#fbbf24", fontWeight: 600 }}>Rate limit reached</span>
              <span style={{ color: "var(--muted-foreground)" }}> — Only 2 queries allowed per 20 minutes.</span>
            </div>
            <div className="ml-auto shrink-0 font-mono font-bold text-base" style={{ color: "#fbbf24" }}>
              {Math.floor(rateLimitSeconds / 60)}:{String(rateLimitSeconds % 60).padStart(2, "0")}
            </div>
          </div>
        )}

        {/* Input bar */}
        <div className="shrink-0 px-4 py-4" style={{ borderTop: "1px solid var(--border)", background: "var(--sidebar)" }}>
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3 items-end px-4 py-3 rounded-2xl"
              style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 4px 32px rgba(0,0,0,0.4)" }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => {
                  setInput(e.target.value)
                  e.target.style.height = "auto"
                  e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"
                }}
                onKeyDown={onKeyDown}
                placeholder={rateLimitSeconds !== null ? "Rate limit active — please wait…" : "Ask a research question…"}
                className="flex-1 bg-transparent resize-none outline-none leading-relaxed text-base"
                style={{
                  color: rateLimitSeconds !== null ? "var(--muted-foreground)" : "var(--foreground)",
                  minHeight: "28px",
                  maxHeight: "160px",
                }}
                rows={1}
                disabled={loading || rateLimitSeconds !== null}
              />
              <button
                onClick={() => handleSubmit()}
                disabled={loading || !input.trim()}
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white transition-all duration-150 text-base font-medium"
                style={loading || !input.trim() ? {
                  background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "not-allowed",
                } : {
                  background: "linear-gradient(135deg, #cc6b45 0%, #e8845a 100%)",
                  boxShadow: "0 2px 12px rgba(204,107,69,0.45)",
                }}
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : "↑"}
              </button>
            </div>
            <p className="text-xs text-center mt-2 opacity-40" style={{ color: "var(--muted-foreground)" }}>
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}



