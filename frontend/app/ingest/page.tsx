"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getTaskStatus, ingestAsync, ingestSync } from "@/lib/api"

const DOMAINS = ["ml", "dl", "cs", "physics", "bio", "finance", "math"]

type Mode = "sync" | "async"

interface IngestResult {
  type: Mode
  taskId?: string
  documentId?: string
  status: string
  message?: string
}

export default function IngestPage() {
  const [title, setTitle] = useState("")
  const [source, setSource] = useState("")
  const [domain, setDomain] = useState("ml")
  const [mode, setMode] = useState<Mode>("async")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [taskStatus, setTaskStatus] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  function startPolling(taskId: string) {
    pollRef.current = setInterval(async () => {
      try {
        const s = await getTaskStatus(taskId)
        setTaskStatus(s.status)
        if (s.status === "completed" || s.status === "failed") clearInterval(pollRef.current!)
      } catch { clearInterval(pollRef.current!) }
    }, 3000)
  }

  async function handleSubmit() {
    const t = title.trim(), s = source.trim()
    if (!t || !s || loading) return
    setLoading(true); setError(null); setResult(null); setTaskStatus(null)
    try {
      if (mode === "sync") {
        const res = await ingestSync({ title: t, source: s, domain })
        setResult({ type: "sync", documentId: res.document_id, status: res.status })
      } else {
        const res = await ingestAsync({ title: t, source: s, domain })
        setResult({ type: "async", taskId: res.task_id, status: res.status, message: res.message })
        startPolling(res.task_id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingestion failed")
    } finally { setLoading(false) }
  }

  const currentStatus = taskStatus ?? result?.status ?? ""
  const statusStyles: Record<string, string> = {
    completed: "bg-emerald-900/60 text-emerald-400 border-emerald-800",
    failed: "bg-red-900/60 text-red-400 border-red-800",
    running: "bg-blue-900/60 text-blue-400 border-blue-800",
    queued: "bg-yellow-900/60 text-yellow-400 border-yellow-800",
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col bg-zinc-900 border-r border-zinc-800">
        <div className="px-5 py-5 border-b border-zinc-800">
          <span className="font-bold text-lg tracking-tight text-white">ResearchOS</span>
          <p className="text-xs text-zinc-500 mt-0.5">AI Research Assistant</p>
        </div>
        <div className="px-4 py-4 flex-1">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Navigation</p>
          <Link href="/">
            <button className="w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
              ← Back to Chat
            </button>
          </Link>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 bg-zinc-950 overflow-auto">
        <div className="max-w-xl mx-auto px-6 py-12">
          <h1 className="text-2xl font-bold text-zinc-100 mb-1">Add Document</h1>
          <p className="text-zinc-500 text-sm mb-8">Ingest a PDF or URL into the knowledge base.</p>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
            {/* Title */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Title</label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Attention Is All You Need"
                disabled={loading}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-blue-600"
              />
            </div>

            {/* Source */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Source</label>
              <Input
                value={source}
                onChange={e => setSource(e.target.value)}
                placeholder="data/arxiv_papers/paper.pdf  or  https://…"
                disabled={loading}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-blue-600"
              />
              <p className="text-xs text-zinc-600">File path (relative to backend root) or a URL</p>
            </div>

            {/* Domain + Mode */}
            <div className="flex gap-3">
              <div className="space-y-2 flex-1">
                <label className="text-sm font-medium text-zinc-300">Domain</label>
                <Select value={domain} onValueChange={setDomain} disabled={loading}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {DOMAINS.map(d => (
                      <SelectItem key={d} value={d} className="text-zinc-100 focus:bg-zinc-700">
                        {d.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 flex-1">
                <label className="text-sm font-medium text-zinc-300">Mode</label>
                <Select value={mode} onValueChange={v => setMode(v as Mode)} disabled={loading}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="async" className="text-zinc-100 focus:bg-zinc-700">Async</SelectItem>
                    <SelectItem value="sync" className="text-zinc-100 focus:bg-zinc-700">Sync (wait)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Submit */}
            <Button
              onClick={handleSubmit}
              disabled={loading || !title.trim() || !source.trim()}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white h-11"
            >
              {loading ? "Ingesting…" : "Ingest Document"}
            </Button>

            {/* Error */}
            {error && (
              <div className="text-sm text-red-400 bg-red-950/50 border border-red-900 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {/* Result */}
            {result && (
              <div className={`rounded-xl border px-4 py-3 space-y-2 ${statusStyles[currentStatus] ?? "bg-zinc-800 border-zinc-700 text-zinc-300"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Status</span>
                  <span className="text-sm font-mono font-semibold capitalize">
                    {currentStatus}
                    {(currentStatus === "queued" || currentStatus === "running") && (
                      <span className="ml-2 animate-pulse">…</span>
                    )}
                  </span>
                </div>
                {result.taskId && (
                  <p className="text-xs opacity-70">
                    Task: <code>{result.taskId}</code>
                  </p>
                )}
                {result.documentId && (
                  <p className="text-xs opacity-70">
                    Doc ID: <code>{result.documentId}</code>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
