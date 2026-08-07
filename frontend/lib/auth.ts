/**
 * Token storage. That is all this file does now.
 *
 * It used to be the entire auth system: accounts in localStorage, passwords
 * "hashed" with btoa() (base64 — reversible in one line), and the backend
 * checking nothing. Real accounts now live in Postgres and the backend verifies
 * a signed JWT on every request, so the browser only needs to remember the
 * token.
 */

const TOKEN_KEY = "ros_token"

export interface User {
  id: string
  email: string
  name: string
  created_at?: string
}

export function getToken(): string | null {
  // Next renders components on the server first, where localStorage does not
  // exist. Without this guard the first render throws.
  if (typeof window === "undefined") return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  // The session id is per-user chat state. Leaving it behind would attach the
  // next person who signs in on this browser to the previous user's session id.
  localStorage.removeItem("ros_session_id")
}
