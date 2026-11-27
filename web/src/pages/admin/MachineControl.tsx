// MACHINE CONTROL
// Purpose: admin state overrides and the audit log

import { Lock, Unlock } from "lucide-react"
import { useState } from "react"
import { GROUP_LABELS } from "../../config/gym-layout"
import { Card } from "../../components/Card"
import { MachineTile } from "../../components/MachineTile"
import { StateBadge } from "../../components/StateBadge"
import { useMachineControl } from "../../hooks"
import { formatDateTime, formatRelative } from "../../lib/format"
import { displayStatus } from "../../lib/machine"
import type { MachineState, overrideMode } from "../../types"
import { useAdmin } from "./context"

const STATES: { state: MachineState; label: string }[] = [
  { state: "AVAILABLE", label: "Available" },
  { state: "ACTIVE", label: "Active" },
  { state: "RESTING", label: "Resting" },
]

// admins set a machines state by hand
//   one-off: the machine carries on as normal from that state
//   hold: it ignores the sensor until released and shows a lock on the map for everyone
// maintenance has its own page
export function MachineControlPage() {
  const { machines, now } = useAdmin()
  const control = useMachineControl()
  const [mode, setMode] = useState<overrideMode>("one-off")
  const [filter, setFilter] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key)
    setMessage(null)
    try {
      await fn()
      setMessage({ ok: true, text: ok })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" })
    } finally {
      setBusy(null)
    }
  }

  const q = filter.trim().toLowerCase()
  const shown = machines.filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
  const held = machines.filter((m) => m.override?.mode === "hold")

  return (
    <>
      <Card title="Set a machine's state" headingID="mc-title">
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <fieldset>
            <legend className="mb-1 text-xs font-bold tracking-wide text-stone-600 uppercase">Override mode</legend>
            <div className="inline-flex rounded-lg bg-cream p-1 ring-1 ring-stone-200">
              {(
                [
                  ["one-off", "One-off", "The simulation (or sensor) carries on from the new state"],
                  ["hold", "Hold", "Pinned until you release it; lock shown on the map"],
                ] as const
              ).map(([m, label, hint]) => (
                <label
                  key={m}
                  title={hint}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold ${mode === m ? "bg-forest text-cream" : "text-stone-700"}`}
                >
                  <input type="radio" name="override-mode" className="sr-only" checked={mode === m} onChange={() => setMode(m)} />
                  {m === "hold" && <Lock size={13} className="mr-1 inline" aria-hidden />}
                  {label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-stone-600">
              {mode === "hold" ? "Pinned until released. Everyone sees a lock badge on the map." : "The machine carries on normally from the new state."}
            </p>
          </fieldset>
          <label className="min-w-48 flex-1">
            <span className="mb-1 block text-xs font-bold tracking-wide text-stone-600 uppercase">Find</span>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="ID or name, e.g. LP01"
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5"
            />
          </label>
        </div>
        {message && (
          <p
            role="status"
            className={`mb-3 rounded-md px-3 py-2 text-sm font-semibold ${message.ok ? "bg-[#E2F4E6] text-[#1B7234]" : "bg-[#FBE4E4] text-active"}`}
          >
            {message.text}
          </p>
        )}
        <p className="mb-3 text-xs text-stone-600">
          Manual changes skip the sensor timing rules but still never jump straight from Active to Available (it goes via Resting). Machines in maintenance are
          managed on the Maintenance page.
        </p>
        <ul className="divide-y divide-stone-100">
          {shown.map((m) => {
            const maint = !!m.maintenance
            const isHeld = m.override?.mode === "hold"
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <MachineTile machine={m} size={36} />
                <div className="min-w-40 flex-1">
                  <p className="text-sm font-semibold text-stone-900">
                    {m.id} · {m.name}
                    {isHeld && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-forest px-2 py-0.5 text-[11px] text-cream">
                        <Lock size={11} aria-hidden /> held by {m.override!.by}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-stone-600">
                    {GROUP_LABELS[m.group]} · <StateBadge state={displayStatus(m)} size="sm" /> {formatRelative(m.since, now)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Set state of ${m.id}`}>
                  {STATES.map((s) => (
                    <button
                      key={s.state}
                      type="button"
                      disabled={maint || busy !== null || (m.state === s.state && (isHeld ? mode === "hold" : mode === "one-off"))}
                      onClick={() =>
                        run(`${m.id}:${s.state}`, () => control.set(m.id, s.state, mode), `${m.id} set to ${s.label}${mode === "hold" ? " and held" : ""}.`)
                      }
                      className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-stone-800 hover:bg-cream disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-forest"
                    >
                      {busy === `${m.id}:${s.state}` ? "…" : s.label}
                    </button>
                  ))}
                  {isHeld && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => run(`${m.id}:release`, () => control.release(m.id), `${m.id} released: back on sensor data.`)}
                      className="inline-flex items-center gap-1 rounded-md bg-forest px-2.5 py-1 text-xs font-semibold text-cream hover:bg-forest-mid disabled:opacity-40"
                    >
                      <Unlock size={12} aria-hidden /> Release
                    </button>
                  )}
                  {maint && <span className="text-xs font-semibold text-[#A04A06]">In maintenance</span>}
                </div>
              </li>
            )
          })}
        </ul>
        {held.length > 0 && (
          <p className="mt-3 text-sm text-stone-700">
            {held.length} machine{held.length === 1 ? " is" : "s are"} held right now.
          </p>
        )}
      </Card>

      <Card title="Audit log" headingID="mc-log">
        {control.error ? (
          <p className="text-sm text-active">Couldn't load the log: {control.error.message}</p>
        ) : !control.log ? (
          <p className="text-sm text-stone-600">Loading…</p>
        ) : control.log.length === 0 ? (
          <p className="text-sm text-stone-600">No manual changes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-stone-200 text-xs text-stone-600">
                <tr>
                  <th scope="col" className="py-2 text-left">
                    When
                  </th>
                  <th scope="col" className="py-2 text-left">
                    Who
                  </th>
                  <th scope="col" className="py-2 text-left">
                    Machine
                  </th>
                  <th scope="col" className="py-2 text-left">
                    From → to
                  </th>
                  <th scope="col" className="py-2 text-left">
                    Mode
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {control.log.map((e) => (
                  <tr key={`${e.machineId}${e.at}`}>
                    <td className="py-2 whitespace-nowrap tabular-nums">{formatDateTime(e.at)}</td>
                    <td className="py-2">{e.by}</td>
                    <td className="py-2 font-semibold">{e.machineId}</td>
                    <td className="py-2 whitespace-nowrap">
                      <StateBadge state={e.from} size="sm" /> → <StateBadge state={e.to} size="sm" />
                    </td>
                    <td className="py-2">{e.mode === "hold" ? "Hold" : "One-off"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
