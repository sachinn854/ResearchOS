"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { queryKBStream, type SourceItem } from "@/lib/api"

const DOMAINS = [
  { value: "all", label: "All Domains" },
  { value: "ml", label: "ML / AI" },
  { value: "dl", label: "Deep Learning" },
  { value: "cs", label: "Computer Sci" },
  { value: "physics", label: "Physics" },
  { value: "bio", label: "Biology" },
  { value: "finance", label: "Finance" },
  { value: "math", label: "Mathematics" },
]

interface Message {
  role: "user" | "assistant"
  content: string
  sources?: SourceItem[]
  chunks_used?: number
}

function randomId() {
  return Math.random().toString(36).slice(2, 10)
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [domain, setDomain] = useState("all")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const tokenQueueRef = useRef<string[]>([])
  const typingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { setSessionId(randomId()) }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  // Typewriter: drain token queue at ~30ms per character
  const startTyping = useCallback(() => {
    if (typingRef.current) return
    typingRef.current = setInterval(() => {
      const token = tokenQueueRef.current.shift()
      if (token === undefined) return
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: updated[updated.length - 1].content + token,
        }
        return updated
      })
    }, 12)
  }, [])

  const stopTyping = useCallback(() => {
    if (typingRef.current) {
      clearInterval(typingRef.current)
      typingRef.current = null
    }
  }, [])

  async function handleSubmit() {
    const query = input.trim()
    if (!query || loading) return
    setInput("")
    setError(null)
    setMessages(prev => [...prev, { role: "user", content: query }])
    setLoading(true)

    // Add empty assistant message — will be filled token by token
    setMessages(prev => [...prev, { role: "assistant", content: "" }])

    try {
      await queryKBStream(
        {
          query,
          domain: domain === "all" ? null : domain,
          session_id: sessionId ?? undefined,
        },
        (event) => {
          if (event.type === "token") {
            // Push individual characters to queue for typewriter effect
            for (const char of event.content) {
              tokenQueueRef.current.push(char)
            }
            startTyping()
          } else if (event.type === "sources") {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                sources: event.sources,
                chunks_used: event.chunks_used,
              }
              return updated
            })
          } else if (event.type === "error") {
            setMessages(prev => prev.slice(0, -1)) // remove empty assistant msg
            setError(event.content)
          }
        }
      )
    } catch (err) {
      stopTyping()
      tokenQueueRef.current = []
      setMessages(prev => prev.slice(0, -1))
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      // Wait for queue to drain before marking done
      const waitForQueue = () => {
        if (tokenQueueRef.current.length === 0) {
          stopTyping()
          setLoading(false)
        } else {
          setTimeout(waitForQueue, 100)
        }
      }
      waitForQueue()
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col bg-zinc-900 border-r border-zinc-800">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-zinc-800">
          <span className="font-bold text-lg tracking-tight text-white">ResearchOS</span>
          <p className="text-xs text-zinc-500 mt-0.5">AI Research Assistant</p>
        </div>

        {/* Domain selector */}
        <div className="px-4 py-4 flex-1">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Domain</p>
          <div className="flex flex-col gap-1">
            {DOMAINS.map(d => (
              <button
                key={d.value}
                onClick={() => setDomain(d.value)}
                className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  domain === d.value
                    ? "bg-blue-600 text-white font-medium"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bottom actions */}
        <div className="px-4 py-4 border-t border-zinc-800 space-y-3">
          <Link href="/ingest">
            <button className="w-full px-3 py-2 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors text-left">
              + Add Document
            </button>
          </Link>
          {sessionId && (
            <p className="text-xs text-zinc-600 px-1">
              Session: <span className="font-mono text-zinc-500">{sessionId}</span>
            </p>
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex flex-col flex-1 bg-zinc-950 overflow-hidden">
        {/* Messages */}
        <ScrollArea className="flex-1 px-6 py-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center">
              <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-4">
                <span className="text-white font-bold text-xl">R</span>
              </div>
              <h2 className="text-xl font-semibold text-zinc-100">What do you want to research?</h2>
              <p className="text-zinc-500 text-sm mt-2 max-w-sm">
                Ask anything about your ingested papers. Select a domain from the sidebar to narrow results.
              </p>
            </div>
          )}

          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${
                  msg.role === "user" ? "bg-blue-600 text-white" : "bg-zinc-700 text-zinc-300"
                }`}>
                  {msg.role === "user" ? "You" : "AI"}
                </div>

                {/* Bubble */}
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-sm"
                    : "bg-zinc-800 text-zinc-100 rounded-tl-sm"
                }`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>

                  {/* Sources */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-zinc-700">
                      <p className="text-xs text-zinc-400 mb-2">
                        {msg.chunks_used} chunks retrieved · {msg.sources.length} sources
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.sources.map((s, si) => (
                          <span
                            key={si}
                            className="inline-flex items-center gap-1 text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full font-mono"
                          >
                            [{si + 1}]
                            {s.page_number != null ? ` p.${s.page_number}` : ""}
                            <span className="text-zinc-500">{s.score.toFixed(2)}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-zinc-700 shrink-0 flex items-center justify-center text-xs font-bold text-zinc-300">AI</div>
                <div className="bg-zinc-800 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1 items-center h-5">
                    <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="text-sm text-red-400 bg-red-950/50 border border-red-900 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Input bar */}
        <div className="shrink-0 px-6 py-4 border-t border-zinc-800 bg-zinc-900">
          <div className="max-w-3xl mx-auto flex gap-3 items-end">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask a research question…"
              className="resize-none bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-blue-600 min-h-[48px] max-h-36"
              rows={1}
              disabled={loading}
            />
            <Button
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-500 text-white shrink-0 h-12 px-5"
            >
              Send
            </Button>
          </div>
          <p className="text-xs text-zinc-600 text-center mt-2">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  )
}
