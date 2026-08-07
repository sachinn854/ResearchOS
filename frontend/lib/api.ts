// BUG-032: was 8000 — docker-compose maps backend to 8001:8000
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001"

import { clearToken, getToken, type User } from "@/lib/auth"

/**
 * Attach the bearer token. Every authenticated call goes through this, so there
 * is exactly one place that knows how the token is sent.
 */
function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken()
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/**
 * Handle an expired or rejected token in one place.
 *
 * A 401 means the token is no longer usable, so keeping it around only produces
 * more 401s. We drop it and send the user to /login. Using window.location
 * rather than the Next router is deliberate: this runs from plain functions
 * outside React, where no router instance is available, and a full reload also
 * clears any stale state the signed-out user could still see.
 */
function handleUnauthorized(): never {
  clearToken()
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login"
  }
  throw new Error("Session expired. Please sign in again.")
}

/**
 * Pull a readable message out of an error response.
 * FastAPI sends {"detail": "..."} which is far more useful to show than the raw
 * JSON body the previous version surfaced.
 */
async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  if (!text) return res.statusText
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed?.detail === "string") return parsed.detail
    if (Array.isArray(parsed?.detail)) {
      // Pydantic validation errors arrive as a list of objects.
      return parsed.detail.map((d: { msg?: string }) => d?.msg).filter(Boolean).join(", ") || text
    }
  } catch { /* not JSON — fall through */ }
  return text
}

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
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(init?.headers),
  })
  if (res.status === 401) handleUnauthorized()
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json()
}

/** Same as request(), but without the 401 redirect. */
async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  // Login and register return 401/409 as a normal outcome — a wrong password
  // must show "Invalid email or password" on the form, not bounce the user to
  // the page they are already on.
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json()
}

// --- auth ------------------------------------------------------------------

export interface TokenResponse {
  access_token: string
  token_type: string
  user: User
}

export function loginRequest(email: string, password: string): Promise<TokenResponse> {
  return publicRequest("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
}

export function registerRequest(name: string, email: string, password: string): Promise<TokenResponse> {
  return publicRequest("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  })
}

export function fetchMe(): Promise<User> {
  return request("/auth/me")
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
  signal?: AbortSignal,  // BUG-012: AbortSignal so callers can cancel mid-stream
): Promise<void> {
  const res = await fetch(`${API_BASE}/research/query/stream`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(req),
    signal,
  })

  if (res.status === 401) handleUnauthorized()

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

// No userId parameter any more: the backend reads the user from the token.
// Passing it from the client was the actual security hole — anyone could send
// someone else's id and read their chat history.
export function fetchSessions(): Promise<SessionItem[]> {
  return request("/research/sessions")
}

export function fetchSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  return request(`/research/sessions/${sessionId}/messages`)
}

export async function uploadFile(file: File, title: string, domain: string): Promise<IngestResponse> {
  const form = new FormData()
  form.append("file", file)
  form.append("title", title)
  form.append("domain", domain)
  // Note: no Content-Type header. fetch sets it for FormData along with the
  // multipart boundary; setting it by hand produces a boundary-less header and
  // the upload fails to parse server-side.
  const res = await fetch(`${API_BASE}/research/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  })
  if (res.status === 401) handleUnauthorized()
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json()
}
