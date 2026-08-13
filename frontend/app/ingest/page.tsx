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
    <div className="bg-canvas flex min-h-dvh flex-col">
      <TopBar active="ingest" />

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-5 py-10 sm:px-8 sm:py-14">

          <header className="mb-8">
            <h1 className="font-display text-display text-foreground">Add a document</h1>
            <p className="mt-3 text-read text-muted-foreground">
              Upload a file or paste a link. When it finishes, you can ask questions
              against it and the answers will cite its pages.
            </p>
          </header>

          <div className="space-y-6">
            {/* Segmented control. The track sits on the list grey, which is darker
                than the card in both themes, so the selected tab can rise to the
                card's own level. */}
            <div className="bg-list flex gap-1 rounded-xl border border-border p-1">
              {(["file", "url"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => switchTab(t)}
                  aria-pressed={tab === t}
                  className={cn(
                    "flex-1 rounded-lg py-2.5 text-ui-lg transition-colors",
                    tab === t
                      ? "bg-card font-bold text-foreground shadow-lift"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "file" ? "Upload a file" : "Paste a link"}
                </button>
              ))}
            </div>

            {tab === "file" && (
              <div>
                {/* Sibling of the button, not a child: a <button> may not contain
                    another interactive element. */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,.docx"
                  className="hidden"
                  onChange={handleFileChange}
                  tabIndex={-1}
                />
                {/* A real <button>, not a div with an onClick: that version could
                    only be reached with a mouse — no Tab stop, no Enter or Space,
                    and nothing for a screen reader to announce. */}
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
                    "w-full rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
                    dragOver || selectedFile
                      ? "border-brand-edge bg-brand-soft"
                      : "hover:border-brand-edge hover:bg-list border-border-strong",
                  )}
                >
                  {selectedFile ? (
                    <>
                      <FileText className="text-brand-deep mx-auto size-8" />
                      <p className="mt-3 text-ui-lg font-bold text-foreground">{selectedFile.name}</p>
                      <p className="mt-1 font-mono text-meta text-ink-subtle">
                        {(selectedFile.size / 1024).toFixed(0)} KB · tap to change
                      </p>
                    </>
                  ) : (
                    <>
                      <Upload className="mx-auto size-8 text-ink-subtle" />
                      <p className="mt-3 text-ui-lg font-bold text-foreground">Drop a file here</p>
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
              label="What should it be called?"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Attention Is All You Need"
              disabled={loading}
              hint="This is the name you will see beside every citation from it."
            />

            <div className="space-y-2">
              <label htmlFor="ingest-domain" className="block text-ui font-bold text-foreground">
                Domain
              </label>
              <DomainSelect
                id="ingest-domain"
                value={domain}
                onChange={setDomain}
                disabled={loading}
                className="h-12 w-full rounded-lg"
              />
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
              className="btn-primary w-full"
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
              // Still working states get the same indeterminate bar the query
              // wait uses, so "something is running" looks the same everywhere in
              // the app rather than once per screen.
              const live = currentStatus === "running" || currentStatus === "queued"
              return (
                <Notice tone={s.tone}>
                  <span className="font-bold">{s.label}</span>
                  {live && <span className="working-bar mt-2 block" />}
                  {currentStatus === "completed" && (
                    <span className="mt-1 block font-normal">Head back to Ask and question it.</span>
                  )}
                  {(result.taskId ?? result.documentId) && (
                    <span className="mt-1 block font-mono text-meta break-all opacity-75">
                      {result.taskId ? `task ${result.taskId}` : `doc ${result.documentId}`}
                    </span>
                  )}
                </Notice>
              )
            })()}
          </div>
        </div>
      </main>
    </div>
  )
}
