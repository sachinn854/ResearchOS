"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  queryKBStream, fetchSessions, fetchSessionMessages,
  RateLimitError, type PipelineInfo, type SourceItem, type SessionItem,
} from "@/lib/api"

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

function getUserId(): string {
  let uid = localStorage.getItem("ros_user_id")
  if (!uid) {
    uid = randomId() + randomId()  // 16-char permanent user token
    localStorage.setItem("ros_user_id", uid)
  }
  return uid
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
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [domain, setDomain] = useState("all")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [showSources, setShowSources] = useState<Record<number, boolean>>({})
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null)
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null)
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const uid = getUserId()
    const stored = localStorage.getItem("ros_session_id")
    // Ensure stored session belongs to this user
    const id = (stored && stored.startsWith(uid + "_")) ? stored : `${uid}_${randomId()}`
    localStorage.setItem("ros_session_id", id)
    setSessionId(id)
    fetchSessions(uid).then(setSessions).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function refreshSessions() {
    try { setSessions(await fetchSessions(getUserId())) } catch { /* non-critical */ }
  }

  async function loadSession(id: string) {
    setError(null)
    setShowSources({})
    setExpandedChunk(null)
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
    const id = `${getUserId()}_${randomId()}`
    localStorage.setItem("ros_session_id", id)
    setSessionId(id)
    setMessages([])
    setError(null)
    setShowSources({})
    setExpandedChunk(null)
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
        }
      )
      refreshSessions()
    } catch (err) {
      setMessages(prev => prev.slice(0, -1))
      if (err instanceof RateLimitError) {
        setRateLimitSeconds(err.retryAfter)
        if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current)
        rateLimitTimerRef.current = setInterval(() => {
          setRateLimitSeconds(prev => {
            if (prev === null || prev <= 1) {
              clearInterval(rateLimitTimerRef.current!)
              rateLimitTimerRef.current = null
              return null
            }
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

  return (
    <div className="flex h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>

      {/* ── Sidebar ── */}
      <aside className="w-60 shrink-0 flex flex-col" style={{ background: "var(--sidebar)", borderRight: "1px solid var(--sidebar-border)" }}>

        {/* Logo + New Chat */}
        <div className="px-4 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
              style={{ background: "linear-gradient(135deg, #4f8ef7 0%, #7c5df7 100%)" }}>
              R
            </div>
            <span className="font-semibold text-[14px]" style={{ color: "var(--foreground)" }}>ResearchOS</span>
          </div>
          <button
            onClick={startNewChat}
            title="New Chat"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all text-base leading-none"
            style={{ color: "var(--muted-foreground)", border: "1px solid var(--border)" }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = "rgba(79,142,247,0.15)"
              el.style.color = "#4f8ef7"
              el.style.borderColor = "rgba(79,142,247,0.4)"
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = ""
              el.style.color = "var(--muted-foreground)"
              el.style.borderColor = "var(--border)"
            }}
          >
            +
          </button>
        </div>

        {/* Chat history list */}
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
                      className="text-left px-3 py-2.5 rounded-lg text-xs transition-all duration-150 w-full"
                      style={active ? {
                        background: "rgba(79,142,247,0.15)",
                        border: "1px solid rgba(79,142,247,0.2)",
                      } : { border: "1px solid transparent" }}
                      onMouseEnter={e => {
                        if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"
                      }}
                      onMouseLeave={e => {
                        if (!active) (e.currentTarget as HTMLElement).style.background = ""
                      }}
                    >
                      <p className="truncate leading-tight font-medium" style={{ color: active ? "#4f8ef7" : "var(--foreground)" }}>
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

        {/* Bottom actions */}
        <div className="px-3 pb-4 pt-3" style={{ borderTop: "1px solid var(--sidebar-border)" }}>
          <Link href="/ingest" className="block">
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150"
              style={{ color: "var(--sidebar-foreground)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)" }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "" }}
            >
              <span className="text-lg leading-none" style={{ color: "#4f8ef7" }}>+</span>
              Upload Document
            </button>
          </Link>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <div className="shrink-0 h-14 flex items-center px-4 gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <select
            value={domain}
            onChange={e => setDomain(e.target.value)}
            className="text-sm rounded-lg px-3 py-1.5 outline-none cursor-pointer"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
          >
            {DOMAINS.map(d => (
              <option key={d.value} value={d.value}>{d.icon} {d.label}</option>
            ))}
          </select>
          {sessionId && (
            <span className="ml-auto text-xs font-mono" style={{ color: "var(--muted-foreground)", opacity: 0.4 }}>
              #{sessionId}
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[55vh] text-center select-none">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 text-2xl font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #4f8ef7 0%, #7c5df7 100%)" }}>
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
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(79,142,247,0.4)"
                        ;(e.currentTarget as HTMLElement).style.color = "var(--foreground)"
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"
                        ;(e.currentTarget as HTMLElement).style.color = "var(--sidebar-foreground)"
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i}>
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-tr-sm text-base leading-relaxed text-white"
                      style={{ background: "linear-gradient(135deg, #4f8ef7 0%, #3a7aec 100%)" }}>
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
                        style={{ background: "linear-gradient(135deg, #4f8ef7 0%, #7c5df7 100%)" }}>
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
                            "--tw-prose-links": "#4f8ef7",
                            "--tw-prose-code": "#a5c8ff",
                            "--tw-prose-pre-bg": "var(--card)",
                            "--tw-prose-pre-code": "#c9d1d9",
                            "--tw-prose-quotes": "var(--muted-foreground)",
                            "--tw-prose-quote-borders": "#4f8ef7",
                            "--tw-prose-hr": "var(--border)",
                          } as React.CSSProperties}
                        >
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <div className="pl-10 flex gap-1.5 items-center h-8">
                        {[0, 150, 300].map(delay => (
                          <span key={delay}
                            className="w-2 h-2 rounded-full animate-bounce"
                            style={{ background: "var(--muted-foreground)", animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </div>
                    )}

                    {msg.pipeline && (
                      <div className="pl-10 flex flex-wrap gap-2 pt-1">
                        {msg.pipeline.methods.map(m => (
                          <span key={m} className="text-xs px-2.5 py-1 rounded-full font-medium"
                            style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "1px solid var(--border)" }}>
                            {m}
                          </span>
                        ))}
                        {msg.pipeline.reranked && (
                          <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                            style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "1px solid var(--border)" }}>
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
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--foreground)" }}
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
                                    style={{ background: isExpanded ? "rgba(79,142,247,0.06)" : si % 2 === 0 ? "var(--card)" : "transparent" }}
                                    onClick={() => setExpandedChunk(isExpanded ? null : chunkKey)}
                                  >
                                    <span className="font-mono text-xs shrink-0 w-7 text-center px-1 py-0.5 rounded"
                                      style={{ background: "rgba(79,142,247,0.15)", color: "#4f8ef7" }}>
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
                style={{ background: "rgba(229,87,87,0.1)", border: "1px solid rgba(229,87,87,0.25)", color: "#e57373" }}>
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Rate limit banner */}
        {rateLimitSeconds !== null && (
          <div className="shrink-0 mx-4 mt-3 px-4 py-3 rounded-xl flex items-center gap-3 text-sm"
            style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)" }}>
            <span className="text-lg">⏳</span>
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
              style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}
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
                  background: "linear-gradient(135deg, #4f8ef7 0%, #3a7aec 100%)",
                  boxShadow: "0 2px 8px rgba(79,142,247,0.4)",
                }}
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : "↑"}
              </button>
            </div>
            <p className="text-xs text-center mt-2" style={{ color: "var(--muted-foreground)", opacity: 0.5 }}>
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
