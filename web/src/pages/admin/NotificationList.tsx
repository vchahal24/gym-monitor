// NOTIFICATION LIST
// Purpose: the admin notifications list used by the bell and the overview

import { Brush, Lock, WifiOff, Wrench, X } from "lucide-react"
import { Link } from "react-router"
import type { adminNotification } from "../../lib/notifications"

const KIND = {
  cleaning: { icon: Brush, tint: "#E3F1E6", ink: "#0B4A2E", label: "Cleaning" },
  service: { icon: Wrench, tint: "#FDE8D7", ink: "#A04A06", label: "Service due" },
  offline: { icon: WifiOff, tint: "#EEEBE6", ink: "#4A443E", label: "Offline node" },
  hold: { icon: Lock, tint: "#FCF3D2", ink: "#5C4300", label: "Long hold" },
} as const

export function NotificationList({
  items,
  onDismiss,
  empty,
  limit,
}: {
  items: adminNotification[]
  onDismiss: (id: string) => void
  empty: string
  limit?: number
}) {
  if (items.length === 0) return <p className="rounded-lg bg-cream px-3 py-3 text-sm text-stone-600">{empty}</p>
  const shown = limit ? items.slice(0, limit) : items
  return (
    <ul className="space-y-2">
      {shown.map((n) => {
        const k = KIND[n.kind]
        return (
          <li key={n.id} className="flex items-start gap-2.5 rounded-lg p-2.5" style={{ backgroundColor: k.tint }}>
            <k.icon size={18} className="mt-0.5 shrink-0" style={{ color: k.ink }} aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-[11px] font-bold tracking-wide uppercase" style={{ color: k.ink }}>
                {k.label}
              </p>
              <Link to={n.href} className="font-semibold text-stone-900 hover:underline">
                {n.title}
              </Link>
              <p className="text-xs text-stone-700">{n.detail}</p>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(n.id)}
              className="rounded p-1 text-stone-500 hover:bg-black/5 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-forest"
              aria-label={`Dismiss: ${n.title}`}
            >
              <X size={14} aria-hidden />
            </button>
          </li>
        )
      })}
      {limit && items.length > limit && <li className="text-xs text-stone-600">and {items.length - limit} more</li>}
    </ul>
  )
}
