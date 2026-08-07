"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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

  return (
    <div className="min-h-screen flex items-center justify-center relative" style={{ background: "var(--background)" }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[30%] w-[700px] h-[700px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(204,107,69,0.06), transparent 70%)" }} />
        <div className="absolute bottom-[-10%] right-[15%] w-[500px] h-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(167,139,250,0.04), transparent 70%)" }} />
      </div>

      <div className="relative w-full max-w-sm px-4">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mb-5"
            style={{ background: "linear-gradient(135deg, #cc6b45 0%, #e8845a 100%)", boxShadow: "0 8px 40px rgba(204,107,69,0.35)" }}>
            R
          </div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>Welcome back</h1>
          <p className="text-sm mt-1.5" style={{ color: "var(--muted-foreground)" }}>Sign in to ResearchOS</p>
        </div>

        <div className="rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                placeholder="••••••••"
                required
                autoComplete="current-password"
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
              disabled={loading || !email || !password}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={loading || !email || !password ? {
                background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "not-allowed"
              } : {
                background: "linear-gradient(135deg, #cc6b45 0%, #e8845a 100%)",
                boxShadow: "0 4px 20px rgba(204,107,69,0.35)",
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center mt-5 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium transition-colors"
            style={{ color: "#e8845a" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#f0c4a8" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#e8845a" }}>
            Create account
          </Link>
        </p>
      </div>
    </div>
  )
}



