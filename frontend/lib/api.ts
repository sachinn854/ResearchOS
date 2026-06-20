const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export interface QueryRequest {
  query: string
  domain?: string | null
  session_id?: string | null
  top_k?: number
}

export interface SourceItem {
  document_id: string
  chunk_index: number
  page_number: number | null
  score: number
  title: string | null
  text: string | null
}

export interface QueryResponse {
  answer: string
  chunks_used: number
  sources: SourceItem[]
}

export interface IngestRequest {
  source: string
  title: string
  domain?: string | null
}

export interface IngestResponse {
  document_id: string
  title: string
  status: string
}

export interface AsyncIngestResponse {
  task_id: string
  status: string
  message: string
}

export interface TaskStatusResponse {
  task_id: string
  status: string
  result?: Record<string, unknown>
  error?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text)
  }
  return res.json()
}

export function queryKB(req: QueryRequest): Promise<QueryResponse> {
  return request("/research/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
}

export interface PipelineInfo {
  methods: string[]
  chunks_retrieved: number
  reranked: boolean
  has_hallucination: boolean
  grader_passed: boolean
}

export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "sources"; sources: SourceItem[]; chunks_used: number }
  | { type: "pipeline"; methods: string[]; chunks_retrieved: number; reranked: boolean; has_hallucination: boolean; grader_passed: boolean }
  | { type: "error"; content: string }
  | { type: "done" }

export class RateLimitError extends Error {
  retryAfter: number
  constructor(retryAfter: number) {
    super("rate_limit")
    this.retryAfter = retryAfter
  }
}

export async function queryKBStream(
  req: QueryRequest,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}/research/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })

  if (res.status === 429) {
    const data = await res.json().catch(() => ({}))
    throw new RateLimitError(data?.detail?.retry_after ?? 1200)
  }

  if (!res.ok || !res.body) throw new Error(await res.text().catch(() => res.statusText))

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const event = JSON.parse(line.slice(6)) as StreamEvent
          onEvent(event)
        } catch { /* skip malformed lines */ }
      }
    }
  }
}

export function ingestSync(req: IngestRequest): Promise<IngestResponse> {
  return request("/research/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
}

export function ingestAsync(req: IngestRequest): Promise<AsyncIngestResponse> {
  return request("/research/ingest/async", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
}

export function getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
  return request(`/research/tasks/${taskId}`)
}

export interface SessionItem {
  session_id: string
  preview: string
  last_at: string | null
  message_count: number
}

export interface SessionMessage {
  role: "user" | "assistant"
  content: string
}

export function fetchSessions(userId: string): Promise<SessionItem[]> {
  return request(`/research/sessions?user_id=${encodeURIComponent(userId)}`)
}

export function fetchSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  return request(`/research/sessions/${sessionId}/messages`)
}

export async function uploadFile(file: File, title: string, domain: string): Promise<IngestResponse> {
  const form = new FormData()
  form.append("file", file)
  form.append("title", title)
  form.append("domain", domain)
  const res = await fetch(`${API_BASE}/research/upload`, { method: "POST", body: form })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text)
  }
  return res.json()
}
