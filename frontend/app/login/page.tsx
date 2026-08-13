"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

import { AuthShell } from "@/components/auth-shell"
import { Notice } from "@/components/notice"
import { TextField } from "@/components/text-field"
import { useAuth } from "@/lib/auth-context"

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // async now — login is a network call to /auth/login rather than a
  // localStorage lookup, so it can fail slowly and has to be awaited.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      router.push("/")
      // No setLoading(false) on success on purpose: we are navigating away, and
      // re-enabling the button first lets an impatient double-click fire a
      // second login.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
      setLoading(false)
    }
  }

  const canSubmit = Boolean(email && password)

  return (
    <AuthShell
      title="Sign in"
      subtitle="Your library and every question you have asked are where you left them."
      footer={
        <>
          Don&apos;t have an account? <Link href="/signup" className="link-primary">Create one</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          autoComplete="email"
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          autoComplete="current-password"
        />

        {error && <Notice>{error}</Notice>}

        <button type="submit" disabled={loading || !canSubmit} className="btn-primary w-full">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>
    </AuthShell>
  )
}
