// ADMIN LOGIN
// Purpose: the admin login page (a frontend only demo login in mock mode)

import { Info, LogIn } from "lucide-react"
import { useState, type FormEvent } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router"
import { useAdminSession } from "../hooks"

export function AdminLoginPage() {
  const { session, login, isMock } = useAdminSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get("next")?.startsWith("/admin") ? params.get("next")! : "/admin"
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to={next} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username.trim(), password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="font-display text-5xl leading-none text-brown">Admin login</h1>
      <p className="mt-1 text-sm text-stone-600">For gym staff: machine popularity, maintenance and sensor health.</p>

      {isMock && (
        <div className="mt-5 flex gap-3 rounded-lg border-2 border-dashed border-mustard bg-[#FCF3D2] px-4 py-3 text-sm text-[#5C4300]" role="note">
          <Info size={20} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-bold">Demo login: frontend only</p>
            <p>
              Username <code className="rounded bg-white px-1 font-semibold">admin</code>, password{" "}
              <code className="rounded bg-white px-1 font-semibold">gym4200</code>. In mock mode this is checked in the browser, so it is not real security.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="mt-5 space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5" noValidate>
        <label className="block text-sm font-semibold text-stone-800">
          Username
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 font-normal focus:border-forest focus:outline-2 focus:outline-forest/30"
          />
        </label>
        <label className="block text-sm font-semibold text-stone-800">
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 font-normal focus:border-forest focus:outline-2 focus:outline-forest/30"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm font-semibold text-active">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !username || !password}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-forest px-4 py-2.5 font-semibold text-cream hover:bg-forest-mid disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mustard"
        >
          <LogIn size={18} aria-hidden /> {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  )
}
