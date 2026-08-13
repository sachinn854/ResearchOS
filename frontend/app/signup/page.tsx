"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

import { AuthShell } from "@/components/auth-shell"
import { Notice } from "@/components/notice"
import { TextField } from "@/components/text-field"
import { useAuth } from "@/lib/auth-context"

// Must match the backend's minimum in backend/api/schemas/auth.py. This page
// previously allowed 6, so a 6 or 7 character password passed the form and then
// came back as an unexplained validation error from the server.
const MIN_PASSWORD_LENGTH = 8

export default function SignupPage() {
  const router = useRouter()
  const { signup } = useAuth()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    setLoading(true)
    try {
      await signup(name, email, password)
      router.push("/")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed")
      setLoading(false)
    }
  }

  const canSubmit = Boolean(name.trim() && email.trim() && password.length >= MIN_PASSWORD_LENGTH)

  return (
    <AuthShell
      title="Create account"
      subtitle="Add a few papers, then ask them anything. Answers cite the passage they came from."
      footer={
        <>
          Already have an account? <Link href="/login" className="link-primary">Sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="Full name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Alex Johnson"
          required
          autoComplete="name"
        />
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
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />

        {error && <Notice>{error}</Notice>}

        <button type="submit" disabled={loading || !canSubmit} className="btn-primary w-full">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </button>
      </form>
    </AuthShell>
  )
}
