"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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

  const canSubmit = name.trim() && email.trim() && password.length >= MIN_PASSWORD_LENGTH

  return (
    <div className="min-h-screen flex items-center justify-center relative" style={{ background: "var(--background)" }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] right-[25%] w-[700px] h-[700px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(204,107,69,0.06), transparent 70%)" }} />
        <div className="absolute bottom-[-15%] left-[10%] w-[500px] h-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(167,139,250,0.04), transparent 70%)" }} />
      </div>

      <div className="relative w-full max-w-sm px-4">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mb-5"
            style={{ background: "linear-gradient(135deg, #cc6b45 0%, #e8845a 100%)", boxShadow: "0 8px 40px rgba(204,107,69,0.35)" }}>
            R
          </div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>Create account</h1>
          <p className="text-sm mt-1.5" style={{ color: "var(--muted-foreground)" }}>Start researching with AI</p>
        </div>

        <div className="rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Full Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Alex Johnson"
                required
                autoComplete="name"
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none transition-all"
                style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(204,107,69,0.5)"; e.currentTarget.style.background = "rgba(204,107,69,0.06)" }}
                onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--secondary)" }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none transition-all"
                style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(204,107,69,0.5)"; e.currentTarget.style.background = "rgba(204,107,69,0.06)" }}
                onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--secondary)" }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none transition-all"
                style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(204,107,69,0.5)"; e.currentTarget.style.background = "rgba(204,107,69,0.06)" }}
                onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--secondary)" }}
              />
            </div>
            {error && (
              <div className="rounded-xl px-3.5 py-2.5 text-sm"
                style={{ background: "rgba(248,113,113,0.08)", color: "#f87171", border: "1px solid rgba(248,113,113,0.2)" }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={loading || !canSubmit ? {
                background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "not-allowed"
              } : {
                background: "linear-gradient(135deg, #cc6b45 0%, #e8845a 100%)",
                boxShadow: "0 4px 20px rgba(204,107,69,0.35)",
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Creating account…
                </span>
              ) : "Create account"}
            </button>
          </form>
        </div>

        <p className="text-center mt-5 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Already have an account?{" "}
          <Link href="/login" className="font-medium transition-colors"
            style={{ color: "#e8845a" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#f0c4a8" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#e8845a" }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}



