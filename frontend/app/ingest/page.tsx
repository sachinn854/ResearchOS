"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileText, Loader2, Upload } from "lucide-react"

import { DomainSelect } from "@/components/domain-select"
import { TopBar } from "@/components/top-bar"
import { Notice } from "@/components/notice"
import { TextField } from "@/components/text-field"
import { getTaskStatus, ingestAsync, uploadFile } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { cn } from "@/lib/utils"

const MAX_FILE_MB = 50
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024

interface IngestResult {
  taskId?: string
  documentId?: string
  status: string
}

/** What each backend status means for the person waiting on it. */
const STATUS: Record<string, { tone: "success" | "error" | "info" | "warning"; label: string }> = {
  completed: { tone: "success", label: "Ready to question" },
  failed: { tone: "error", label: "Could not be read" },
  running: { tone: "info", label: "Reading it now" },
  queued: { tone: "warning", label: "Waiting for a worker" },
}

export default function IngestPage() {
  const { user, loading: authLoading } = useAuth()
  const [title, setTitle] = useState("")
  const [domain, setDomain] = useState("ml")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [taskStatus, setTaskStatus] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [urlSource, setUrlSource] = useState("")
  const [tab, setTab] = useState<"file" | "url">("file")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Don't redirect until the provider has finished verifying the token,
    // otherwise a refresh bounces the user to /login while user is still null.
    if (!authLoading && !user) window.location.href = "/login"
  }, [authLoading, user])

  useEffect(() => {
    // Separate effect so the poll cleanup does not re-register every time the
    // auth state settles.
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  function startPolling(taskId: string) {
    pollRef.current = setInterval(async () => {
      try {
        const s = await getTaskStatus(taskId)
        setTaskStatus(s.status)
        if (s.status === "completed" || s.status === "failed") clearInterval(pollRef.current!)
      } catch { clearInterval(pollRef.current!) }
    }, 3000)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.size > MAX_FILE_BYTES) { setError(`That file is over the ${MAX_FILE_MB}MB limit.`); return }
    setSelectedFile(file)
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""))
  }, [title])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB, over the ${MAX_FILE_MB}MB limit.`)
      return
    }
    setSelectedFile(file)
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""))
  }

  // BUG-035: switching tabs used to leave the other tab's state behind, which
  // caused three separate surprises:
  //   1. Pick a file -> go to URL tab -> come back -> pick the SAME file again.
  //      Nothing happened. The <input type="file"> still held that filename, so
  //      the browser saw no change and never fired onChange. We have to reset
  //      the input's own value, not just our React state.
  //   2. The old error message stayed on screen while you typed in the new tab.
  //   3. After a finished ingest, the old success card (and its 3s poll) kept
  //      running while you started a completely new upload.
  function switchTab(next: "file" | "url") {
    if (next === tab) return

    setTab(next)
    setError(null)
    setResult(null)
    setTaskStatus(null)

    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }

    if (next === "file") {
      setUrlSource("")
    } else {
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handleSubmit() {
    const t = title.trim()
    if (!t || loading) return
    setLoading(true); setError(null); setResult(null); setTaskStatus(null)
    try {
      if (tab === "file") {
        if (!selectedFile) { setError("Choose a file first."); setLoading(false); return }
        const res = await uploadFile(selectedFile, t, domain)
        setResult({ documentId: res.document_id, status: res.status })
      } else {
        const u = urlSource.trim()
        if (!u) { setError("Paste a link first."); setLoading(false); return }
        const res = await ingestAsync({ title: t, source: u, domain })
        setResult({ taskId: res.task_id, status: res.status })
        startPolling(res.task_id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The document could not be added. Try again.")
    } finally { setLoading(false) }
  }

  const currentStatus = taskStatus ?? result?.status ?? ""
  const canSubmit = Boolean(title.trim()) && (tab === "file" ? Boolean(selectedFile) : Boolean(urlSource.trim()))

  if (authLoading || !user) return <div className="bg-canvas h-dvh" />

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <TopBar active="ingest" />

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-5 py-8 sm:px-6 sm:py-10">
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
            <div>
              <header className="mb-6">
                <p className="label-meta">Library</p>
                <h1 className="mt-2 font-serif text-[30px] font-semibold leading-none tracking-[-0.03em] text-foreground sm:text-[34px]">
                  Add a document
                </h1>
                <p className="mt-3 max-w-[52ch] text-[15px] leading-6 text-muted-foreground">
                  Upload a file or paste a link. When it finishes, you can ask questions against it and the
                  answers will cite its pages.
                </p>
              </header>

              <div className="space-y-6 rounded-[20px] border border-border bg-card p-5 shadow-lift sm:p-6">
                <div className="flex gap-1 rounded-full border border-border bg-list p-1">
                  {(["file", "url"] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => switchTab(t)}
                      aria-pressed={tab === t}
                      className={cn(
                        "flex-1 rounded-full py-2.5 text-[14px] font-semibold transition-colors",
                        tab === t
                          ? "bg-card text-foreground shadow-lift"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t === "file" ? "Upload a file" : "Paste a link"}
                    </button>
                  ))}
                </div>

                {tab === "file" && (
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt,.md,.docx"
                      className="hidden"
                      onChange={handleFileChange}
                      tabIndex={-1}
                    />
                    <button
                      type="button"
                      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      aria-label={
                        selectedFile
                          ? `${selectedFile.name} selected. Choose a different file`
                          : `Choose a file. PDF, DOCX, TXT or MD, up to ${MAX_FILE_MB} megabytes`
                      }
                      className={cn(
                        "w-full rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors sm:py-12",
                        dragOver || selectedFile
                          ? "border-brand-edge bg-brand-soft"
                          : "border-border-strong bg-card hover:border-brand-edge hover:bg-list",
                      )}
                    >
                      {selectedFile ? (
                        <>
                          <FileText className="mx-auto size-8 text-brand-deep" />
                          <p className="mt-3 text-[14px] font-bold text-foreground">{selectedFile.name}</p>
                          <p className="mt-1 font-mono text-[11px] tracking-[0.04em] text-ink-subtle">
                            {(selectedFile.size / 1024).toFixed(0)} KB · tap to change
                          </p>
                        </>
                      ) : (
                        <>
                          <Upload className="mx-auto size-8 text-ink-subtle" />
                          <p className="mt-3 text-[15px] font-bold text-foreground">Drop a file here</p>
                          <p className="mt-1 text-[13px] text-muted-foreground">
                            or tap to browse · PDF, DOCX, TXT, MD · up to {MAX_FILE_MB}MB
                          </p>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {tab === "url" && (
                  <TextField
                    label="Link to the document"
                    value={urlSource}
                    onChange={e => setUrlSource(e.target.value)}
                    placeholder="https://arxiv.org/pdf/2005.11401"
                    disabled={loading}
                  />
                )}

                <TextField
                  label="What should it be called?"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Attention Is All You Need"
                  disabled={loading}
                  hint="This is the name you will see beside every citation from it."
                />

                <div className="space-y-2">
                  <label htmlFor="ingest-domain" className="block text-[14px] font-bold text-foreground">
                    Domain
                  </label>
                  <DomainSelect
                    id="ingest-domain"
                    value={domain}
                    onChange={setDomain}
                    disabled={loading}
                    className="h-12 w-full rounded-full border-border bg-list px-4"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading || !canSubmit}
                  className="btn-primary w-full rounded-full py-3"
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Adding it…
                    </>
                  ) : (
                    "Add to my library"
                  )}
                </button>

                {error && <Notice>{error}</Notice>}

                {result && (() => {
                  const s = STATUS[currentStatus] ?? { tone: "info" as const, label: currentStatus }
                  const live = currentStatus === "running" || currentStatus === "queued"
                  return (
                    <Notice tone={s.tone}>
                      <span className="font-bold">{s.label}</span>
                      {live && <span className="working-bar mt-2 block" />}
                      {currentStatus === "completed" && (
                        <span className="mt-1 block font-normal">Head back to Ask and question it.</span>
                      )}
                      {(result.taskId ?? result.documentId) && (
                        <span className="mt-1 block break-all font-mono text-[11px] opacity-75">
                          {result.taskId ? `task ${result.taskId}` : `doc ${result.documentId}`}
                        </span>
                      )}
                    </Notice>
                  )
                })()}
              </div>
            </div>

            <div className="space-y-4 lg:sticky lg:top-6">
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="label-meta">What happens next</p>
                <ol className="mt-3 space-y-3">
                  <li className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-[11px] font-bold text-brand-deep">
                      1
                    </span>
                    <span className="text-[13px] leading-5 text-muted-foreground">
                      <span className="font-semibold text-foreground">Parsed & chunked</span> — text extracted,
                      cleaned, and split into passages.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-[11px] font-bold text-brand-deep">
                      2
                    </span>
                    <span className="text-[13px] leading-5 text-muted-foreground">
                      <span className="font-semibold text-foreground">Embedded & indexed</span> — ready for dense
                      + sparse search.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-[11px] font-bold text-brand-deep">
                      3
                    </span>
                    <span className="text-[13px] leading-5 text-muted-foreground">
                      <span className="font-semibold text-foreground">Cited answers</span> — ask and every claim
                      points to its page.
                    </span>
                  </li>
                </ol>
              </div>

              <div className="rounded-2xl border border-border bg-list p-4 text-[13px] leading-5 text-muted-foreground">
                Tip: give the document the exact title you want to see in citations. It is what appears beside
                every [n] marker.
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
