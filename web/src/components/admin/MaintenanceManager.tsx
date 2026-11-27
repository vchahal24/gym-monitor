// MAINTENANCE MANAGER
// Purpose: the admin form for putting machines in and out of maintenance, plus downtime totals

import { useState, type FormEvent } from "react"
import { GROUP_LABELS } from "../../config/gym-layout"
import { useMaintenanceActions } from "../../hooks"
import type { popularityRow } from "../../lib/admin"
import { formatDate } from "../../lib/format"
import { displayStatus } from "../../lib/machine"
import type { Machine } from "../../types"
import { Card } from "../Card"
import { MachineTile } from "../MachineTile"
import { StateBadge } from "../StateBadge"

// put machines in / out of maintenance, in mock mode the live map updates straight away
export function MaintenanceManager({ machines, rows }: { machines: Machine[]; rows: popularityRow[] }) {
  const actions = useMaintenanceActions()
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const downtime = new Map(rows.map((r) => [r.id, r]))
  const sorted = [...machines].sort((a, b) => Number(!!b.maintenance) - Number(!!a.maintenance) || a.id.localeCompare(b.id))
  const totalDown = rows.reduce((s, r) => s + r.downtimeHours, 0)

  async function run(id: string, fn: () => Promise<Machine>, ok: string) {
    setBusy(id)
    setMessage(null)
    try {
      await fn()
      setMessage({ ok: true, text: ok })
      setEditing(null)
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title="Maintenance" headingID="maint-mgr-title">
      <p className="mb-3 text-sm text-stone-700">
        {machines.filter((m) => m.maintenance).length} machines out of service now · {Math.round(totalDown)} h of downtime in the last 4 weeks. A machine in
        maintenance is frozen on the map and left out of availability and usage stats.
      </p>
      {message && (
        <p
          role="status"
          className={`mb-3 rounded-md px-3 py-2 text-sm font-semibold ${message.ok ? "bg-[#E2F4E6] text-[#1B7234]" : "bg-[#FBE4E4] text-active"}`}
        >
          {message.text}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-stone-200 text-xs text-stone-600">
            <tr>
              <th scope="col" className="py-2 text-left">
                Machine
              </th>
              <th scope="col" className="py-2 text-left">
                Status
              </th>
              <th scope="col" className="py-2 text-right">
                Downtime 4 wk
              </th>
              <th scope="col" className="py-2 text-right">
                All time
              </th>
              <th scope="col" className="py-2 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sorted.map((m) => {
              const d = downtime.get(m.id)
              return (
                <Row
                  key={m.id}
                  machine={m}
                  down4w={d?.downtimeHours ?? 0}
                  downAll={d?.downtimeHoursTotal ?? 0}
                  editing={editing === m.id}
                  busy={busy === m.id}
                  onEdit={() => setEditing(editing === m.id ? null : m.id)}
                  onSave={(reason, expectedBack) =>
                    run(
                      m.id,
                      () => actions.set(m.id, { since: m.maintenance?.since ?? new Date().toISOString(), reason, expectedBack }),
                      `${m.name} is ${m.maintenance ? "updated" : "now in maintenance"}.`,
                    )
                  }
                  onClear={() => run(m.id, () => actions.clear(m.id), `${m.name} is back in service.`)}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// one machine in the maintenance table
function Row({
  machine: m,
  down4w,
  downAll,
  editing,
  busy,
  onEdit,
  onSave,
  onClear,
}: {
  machine: Machine
  down4w: number
  downAll: number
  editing: boolean
  busy: boolean
  onEdit: () => void
  onSave: (reason: string, expectedBack: string | null) => void
  onClear: () => void
}) {
  const [reason, setReason] = useState(m.maintenance?.reason ?? "")
  const [back, setBack] = useState(m.maintenance?.expectedBack ? toDateInput(m.maintenance.expectedBack) : "")
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!reason.trim()) return
    onSave(reason.trim(), back ? new Date(`${back}T12:00:00`).toISOString() : null)
  }
  const btn =
    "rounded-md px-2.5 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-forest disabled:opacity-50"

  return (
    <>
      <tr>
        <td className="py-2">
          <span className="flex items-center gap-2">
            <MachineTile machine={m} size={28} />
            <span>
              <span className="font-semibold">
                {m.id} {m.name}
              </span>
              <span className="block text-xs text-stone-500">{GROUP_LABELS[m.group]}</span>
            </span>
          </span>
        </td>
        <td className="py-2">
          <StateBadge state={displayStatus(m)} />
          {m.maintenance && (
            <span className="mt-0.5 block max-w-[16rem] text-xs text-stone-600">
              Since {formatDate(m.maintenance.since)} · {m.maintenance.reason}
              {m.maintenance.expectedBack && ` · back ${formatDate(m.maintenance.expectedBack)}`}
            </span>
          )}
        </td>
        <td className="py-2 text-right tabular-nums">{down4w >= 0.5 ? `${Math.round(down4w)} h` : "—"}</td>
        <td className="py-2 text-right tabular-nums">{downAll >= 0.5 ? `${Math.round(downAll)} h` : "—"}</td>
        <td className="py-2 text-right whitespace-nowrap">
          {m.maintenance ? (
            <>
              <button type="button" onClick={onEdit} className={`${btn} text-forest hover:bg-cream`} aria-expanded={editing}>
                Edit
              </button>
              <button type="button" onClick={onClear} disabled={busy} className={`${btn} ml-1 bg-forest text-cream hover:bg-forest-mid`}>
                Return to service
              </button>
            </>
          ) : (
            <button type="button" onClick={onEdit} className={`${btn} border border-[#F07B1F] text-[#A04A06] hover:bg-[#FDE8D7]`} aria-expanded={editing}>
              Put into maintenance
            </button>
          )}
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={5} className="bg-cream px-3 py-3">
            <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
              <label className="min-w-[14rem] flex-1 text-xs font-semibold text-stone-700">
                Reason
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  placeholder="e.g. Frayed cable, replacement on order"
                  className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-semibold text-stone-700">
                Expected back
                <input
                  type="date"
                  value={back}
                  onChange={(e) => setBack(e.target.value)}
                  className="mt-1 block rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm font-normal"
                />
              </label>
              <button type="submit" disabled={busy || !reason.trim()} className={`${btn} bg-[#F07B1F] py-2 text-[#2B1405] hover:brightness-105`}>
                {m.maintenance ? "Save changes" : "Put into maintenance"}
              </button>
              <button type="button" onClick={onEdit} className={`${btn} py-2 text-stone-700 hover:bg-white`}>
                Cancel
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  )
}

// ISO -> "2026-11-23" for a date input (local time)
function toDateInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
