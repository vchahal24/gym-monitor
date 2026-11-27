// ADMIN LAYOUT
// Purpose: the /admin shell, header with the bell, sidebar or section picker, and the shared admin data

import { Bell, LogOut } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { useAdminData, useAdminSession, useAllSensorHealth, useMachines, useNotifications, useNow } from "../../hooks"
import { toCSV } from "../../lib/admin"
import { computeAdminView } from "../../lib/adminView"
import { downloadText } from "../../lib/storage"
import { localDateKey } from "../../lib/time"
import type { adminContext } from "./context"
import { ADMIN_SECTIONS } from "./nav"
import { NotificationList } from "./NotificationList"

// shell for /admin/*, header with the bell, sidebar (desktop) or a section picker (phone), guarded by <RequireAdmin>
export function AdminLayout() {
  const now = useNow(5000)
  const { session, logout, isMock } = useAdminSession()
  const { data, error } = useAdminData()
  const { machines } = useMachines()
  const health = useAllSensorHealth()
  const view = useMemo(() => (data ? computeAdminView(data) : null), [data])
  const notes = useNotifications(data)
  const location = useLocation()
  const navigate = useNavigate()
  const current = ADMIN_SECTIONS.find((s) => location.pathname.startsWith(`/admin/${s.path}`)) ?? ADMIN_SECTIONS[0]

  const stamp = localDateKey(now)
  const ctx: adminContext = {
    now,
    view,
    raw: data,
    error,
    machines,
    health,
    isMock,
    exportPopularity: () => {
      if (!view) return
      const rows = [
        ["rank", "id", "name", "group", "kind", "utilisation_4w", "sessions_4w", "avg_session_min", "downtime_h_4w"],
        ...view.rows.map((r, i) => [
          i + 1,
          r.id,
          r.name,
          r.group,
          r.kind,
          r.utilisation.toFixed(3),
          r.sessions,
          (r.avgWorkoutSeconds / 60).toFixed(1),
          r.downtimeHours.toFixed(1),
        ]),
      ]
      // NOTE: in api mode GET /api/admin/export/popularity.csv could serve this, its built here so both modes match
      downloadText(`popularity-${stamp}.csv`, toCSV(rows), "text/csv")
    },
    exportRecommendations: () => {
      if (!view) return
      const rows = [["type", "title", "detail", "machines", "value"], ...view.recs.map((r) => [r.type, r.title, r.detail, r.machineIds.join(" "), r.value])]
      downloadText(`recommendations-${stamp}.csv`, toCSV(rows), "text/csv")
    },
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wide text-stone-500 uppercase">Owner dashboard</p>
          <h1 className="font-display text-4xl leading-none text-brown sm:text-5xl">{current.label}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {current.blurb}. Last 4 weeks of sensor data{isMock ? " (simulated)" : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-stone-700">
          <NotificationBell notes={notes} />
          <span className="hidden sm:inline">
            Signed in as <strong>{session?.username}</strong>
            {isMock && <span className="ml-1 rounded bg-[#FCF3D2] px-1.5 py-0.5 text-xs font-semibold text-[#5C4300]">demo login</span>}
          </span>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 font-semibold hover:bg-cream focus-visible:outline-2 focus-visible:outline-forest"
          >
            <LogOut size={15} aria-hidden /> Log out
          </button>
        </div>
      </div>

      {/* phone: a section picker */}
      <label className="block lg:hidden">
        <span className="sr-only">Admin section</span>
        <select
          value={current.path}
          onChange={(e) => navigate(`/admin/${e.target.value}`)}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-semibold text-stone-900"
        >
          {ADMIN_SECTIONS.map((s) => (
            <option key={s.path} value={s.path}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="Admin sections" className="hidden lg:block">
          <ul className="sticky top-4 space-y-0.5 rounded-xl bg-white p-2 shadow-sm ring-1 ring-black/5">
            {ADMIN_SECTIONS.map((s) => (
              <li key={s.path}>
                <NavLink
                  to={`/admin/${s.path}`}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-forest ${
                      isActive ? "bg-forest text-cream" : "text-stone-700 hover:bg-cream"
                    }`
                  }
                >
                  <s.icon size={16} aria-hidden /> {s.label}
                  {s.path === "overview" && notes.unread.length > 0 && (
                    <span className="ml-auto rounded-full bg-mustard px-1.5 text-xs text-brown">{notes.unread.length}</span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-5">
          {error && (
            <p role="alert" className="rounded-lg bg-[#FBE4E4] px-4 py-3 text-sm text-active">
              Couldn't load dashboard data: {error.message}
            </p>
          )}
          <Outlet context={ctx} />
        </div>
      </div>
    </div>
  )
}

function NotificationBell({ notes }: { notes: ReturnType<typeof useNotifications> }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const location = useLocation()
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      return !wrap.current?.contains(e.target as Node) && setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      return e.key === "Escape" && setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])
  // close it when the page changes
  const [path, setPath] = useState(location.pathname)
  if (path !== location.pathname) {
    setPath(location.pathname)
    setOpen(false)
  }
  const n = notes.unread.length
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Notifications: ${n} unread`}
        className="relative rounded-lg border border-stone-300 bg-white p-2 hover:bg-cream focus-visible:outline-2 focus-visible:outline-forest"
      >
        <Bell size={18} aria-hidden />
        {n > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-active px-1 text-center text-xs leading-5 font-bold text-white" aria-hidden>
            {n}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl bg-white p-3 shadow-lg ring-1 ring-black/10"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-xl text-brown">Notifications</h2>
            {n > 0 && (
              <button type="button" onClick={notes.dismissAll} className="text-xs font-semibold text-forest underline">
                Dismiss all
              </button>
            )}
          </div>
          <NotificationList items={notes.unread} onDismiss={notes.dismiss} empty="All caught up." />
          <Link to="/admin/overview" className="mt-2 block text-right text-xs font-semibold text-forest underline">
            Open overview
          </Link>
        </div>
      )}
    </div>
  )
}
