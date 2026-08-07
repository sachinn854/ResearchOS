"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"

import { clearToken, getToken, setToken, type User } from "@/lib/auth"
import { fetchMe, loginRequest, registerRequest } from "@/lib/api"

interface AuthState {
  user: User | null
  /**
   * True until we have finished asking the backend who the stored token belongs
   * to. Pages must wait for this before deciding to redirect — otherwise on
   * every refresh there is a moment where user is null but the token is fine,
   * and the user gets bounced to /login for no reason.
   */
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // `cancelled` guards against setting state after unmount, which happens on
    // a fast navigation away while /auth/me is still in flight.
    let cancelled = false

    // Verify the token with the backend rather than trusting a cached user
    // object. A token can be expired, or signed with a secret that has since
    // been rotated, and only the server knows that.
    //
    // The no-token case returns null through the same promise instead of calling
    // setLoading(false) directly in the effect body. Both paths then settle in a
    // callback, which avoids the extra synchronous render the React Compiler
    // lint rule (react-hooks/set-state-in-effect) warns about.
    const resolveUser = async () => (getToken() ? await fetchMe() : null)

    resolveUser()
      .then(loaded => { if (!cancelled) setUser(loaded) })
      .catch(() => clearToken())
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginRequest(email, password)
    setToken(res.access_token)
    setUser(res.user)
  }, [])

  const signup = useCallback(async (name: string, email: string, password: string) => {
    const res = await registerRequest(name, email, password)
    // Register returns a token too, so a new user is signed in straight away
    // rather than being sent to the login page to type it all again.
    setToken(res.access_token)
    setUser(res.user)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  // Throwing beats returning a null-ish default: a component used outside the
  // provider would otherwise look permanently signed out, which is a confusing
  // bug to chase.
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>")
  return context
}
