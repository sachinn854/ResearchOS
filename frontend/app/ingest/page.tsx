"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileText, Loader2, Upload } from "lucide-react"

import { DomainSelect } from "@/components/domain-select"
import { AppShell } from "@/components/app-shell"
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

/** The pipeline a document walks through once submitted — shown as a live
 *  readout beside the form so waiting has something to watch. */
const PIPELINE_STEPS = [
  { key: "parse", label: "Parsed & chunked", detail: "text extracted, cleaned, split into passages" },
  { key: "index", label: "Embedded & indexed", detail: "dense + sparse search vectors built" },
  { key: "cited", label: "Cited answers", detail: "every claim points back to its page" },
]

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

  // BUG-035: switching tabs must reset the other tab's state AND the file
  // input's own value, or re-picking the same file fires no onChange.
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
  const live = currentStatus === "running" || currentStatus === "queued"
  const completed = currentStatus === "completed"

  // Which pipeline step the readout should highlight.
  const activeStep = completed ? PIPELINE_STEPS.length : result ? Math.min(1, PIPELINE_STEPS.length - 1) : -1

  if (authLoading || !user) return <div className="bg-canvas h-dvh" />

  return (
    <AppShell
      sessions={[]}
      activeSessionId={null}
      sessionsFailed={false}
      onRetry={() => {}}
      onSelectSession={() => {}}
      onNewChat={() => { window.location.href = "/" }}
      domain={domain}
      onDomainChange={setDomain}
      showLibrary={false}
    >
      <main className="mx-auto w-full max-w-[1040px] px-5 py-10 sm:px-6 sm:py-14">
        <header className="animate-rise-in max-w-xl">
          <p className="label-meta">Library / Add</p>
          <h1 className="font-display mt-3 text-display font-semibold leading-none tracking-[-0.03em] text-foreground">
            Add a document
          </h1>
          <p className="mt-4 text-ui-lg leading-relaxed text-muted-foreground">
            Drop in a file or paste a link. When it lands, question it from Ask — every answer will
            cite its pages.
          </p>
        </header>

        <div className="mt-10 grid items-start gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          {/* --- the form ------------------------------------------------ */}
          <section aria-label="Add a document" className="panel animate-rise-in space-y-6 p-6 shadow-lift sm:p-7">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-list p-1">
              {(["file", "url"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => switchTab(t)}
                  aria-pressed={tab === t}
                  className={cn(
                    "rounded-md py-2 text-ui font-medium transition-colors",
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
                    "w-full rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
                    dragOver || selectedFile
                      ? "border-brand-edge bg-brand-soft"
                      : "border-border-strong bg-list hover:border-brand-edge",
                  )}
                >
                  {selectedFile ? (
                    <>
                      <FileText className="mx-auto size-7 text-brand-deep" />
                      <p className="mt-3 text-ui font-semibold text-foreground">{selectedFile.name}</p>
                      <p className="mt-1 font-mono text-meta text-ink-subtle">
                        {(selectedFile.size / 1024).toFixed(0)} KB · tap to change
                      </p>
                    </>
                  ) : (
                    <>
                      <Upload className="mx-auto size-7 text-ink-subtle" />
                      <p className="mt-3 font-display text-ui-lg font-semibold text-foreground">Drop a file here</p>
                      <p className="mt-1 text-ui text-muted-foreground">
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
              label="Title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Attention Is All You Need"
              disabled={loading}
              hint="This is the name shown beside every citation from this document."
            />

            <div className="space-y-1.5">
              <label htmlFor="ingest-domain" className="label-meta block">Domain</label>
              <DomainSelect
                id="ingest-domain"
                value={domain}
                onChange={setDomain}
                disabled={loading}
                className="h-11 w-full rounded-lg border-border bg-list px-3.5"
              />
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
              className="btn-primary w-full py-3"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Adding it…
                </>
              ) : (
                "Add to library"
              )}
            </button>

            {error && <Notice>{error}</Notice>}

            {result && (() => {
              const s = STATUS[currentStatus] ?? { tone: "info" as const, label: currentStatus }
              return (
                <Notice tone={s.tone}>
                  <span className="font-semibold">{s.label}</span>
                  {live && <span className="sweep-bar mt-2 block" />}
                  {completed && (
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
          </section>

          {/* --- the pipeline readout ------------------------------------- */}
          <aside aria-label="What happens next" className="space-y-4 lg:sticky lg:top-20">
            <div className="panel p-6">
              <p className="label-meta">Pipeline</p>
              <ol className="mt-5 space-y-0">
                {PIPELINE_STEPS.map((step, i) => {
                  const done = activeStep > i
                  const isActive = activeStep === i && live
                  return (
                    <li key={step.key} className="relative flex gap-4 pb-7 last:pb-0">
                      {/* Connector line between the nodes; drawn per-item so it
                          never extends past the last one. */}
                      {i < PIPELINE_STEPS.length - 1 && (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute top-8 bottom-0 left-[13px] w-px",
                            done ? "bg-primary" : "bg-border",
                          )}
                        />
                      )}
                      <span
                        className={cn(
                          "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[11px] font-semibold transition-colors",
                          done
                            ? "border-primary bg-primary text-primary-foreground"
                            : isActive
                              ? "border-brand-edge bg-brand-soft text-brand-deep"
                              : "border-border-strong bg-card text-ink-subtle",
                        )}
                      >
                        {done ? "✓" : i + 1}
                      </span>
                      <span className="min-w-0 pt-0.5">
                        <span className={cn("block text-ui font-semibold", done || isActive ? "text-foreground" : "text-muted-foreground")}>
                          {step.label}
                        </span>
                        <span className="mt-0.5 block text-meta leading-relaxed text-ink-subtle">{step.detail}</span>
                        {isActive && <span className="sweep-bar mt-2 block max-w-[140px]" />}
                      </span>
                    </li>
                  )
                })}
              </ol>

              {!result && (
                <p className="mt-5 border-t border-border pt-4 font-mono text-meta leading-relaxed text-ink-subtle">
                  Status: idle — submit a document to begin.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-list p-4 text-ui leading-relaxed text-muted-foreground">
              Tip: give the document the exact title you want to see in citations — it appears beside
              every numbered marker.
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  )
}
