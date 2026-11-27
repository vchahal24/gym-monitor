// SENSOR DETAILS
// Purpose: the live readout of a real sensor node on its machine page (hybrid mode only)

import { Activity } from "lucide-react"
import { formatDate, formatDuration, formatRelative } from "../../lib/format"
import type { Machine, recordingInfo } from "../../types"
import { offlineLabel } from "../stateMeta"

// dynamic g from the heartbeats and state packets, XBee address, boot id, last heartbeat, time online,
// the firmware timing in use and how much real data has been recorded
export function SensorDetails({
  machine,
  recording,
  thresholdG,
  now,
}: {
  machine: Machine
  recording: recordingInfo | undefined
  thresholdG: number | undefined
  now: Date
}) {
  const s = machine.sensor
  const timing = machine.timing
  if (!s || !timing) return null
  const reporting = machine.online
  const g = s.dynamicG
  // bar scaled so the movement threshold sits at a quarter of the width
  const scale = thresholdG ? thresholdG * 4 : 0.4
  const moving = g !== null && thresholdG !== undefined && g >= thresholdG

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg bg-cream px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-stone-600">
          <Activity size={14} aria-hidden /> Dynamic acceleration
        </p>
        <p className="mt-0.5 font-display text-4xl leading-none text-forest tabular-nums" aria-live="polite">
          {g === null || !reporting ? "—" : `${g.toFixed(3)} g`}
        </p>
        {g !== null && reporting && (
          <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-heat-0" aria-hidden>
            <div className={`h-full rounded-full ${moving ? "bg-active" : "bg-forest-mid"}`} style={{ width: `${Math.min(100, (g / scale) * 100)}%` }} />
            {thresholdG !== undefined && <div className="absolute inset-y-0 border-l-2 border-stone-800" style={{ left: "25%" }} />}
          </div>
        )}
        <p className="mt-1 text-xs text-stone-600">
          {reporting
            ? `From the latest packet${thresholdG !== undefined ? `, movement counts from ${thresholdG.toFixed(2)} g (the line)` : ""}`
            : offlineLabel(machine).label}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Row label="XBee address" value={s.xbeeAddress ?? "—"} mono />
        <Row label="Boot id" value={s.bootId ? `${s.bootId} · rev ${s.revision ?? 0}` : "—"} mono />
        <Row label="Last heartbeat" value={machine.lastHeartbeat ? formatRelative(machine.lastHeartbeat, now) : "never"} />
        <Row
          label="Online for"
          value={reporting && s.onlineSince ? formatDuration((now.getTime() - Date.parse(s.onlineSince)) / 1000) : s.sensorError ? "sensor error" : "offline"}
        />
      </dl>
      <p className="text-xs text-stone-600">
        Firmware timing ({timing.source === "motion.h" ? "from motion.h" : "bridge default, motion.h not read"}): Resting{" "}
        {seconds(timing.restingDelaySeconds)} and Available {seconds(timing.restingTimeoutSeconds)} after the last movement.
      </p>
      {recording && (
        <p className="rounded-lg bg-[#E2F4E6] px-3 py-2 text-xs font-semibold text-[#1B7234]">
          {recording.since ? `Collecting real data since ${formatDate(recording.since)} · ${recording.hours.toFixed(1)} h recorded` : "No real data recorded yet"}
          {!recording.enough && " · not enough for rankings yet"}
        </p>
      )}
    </div>
  )
}

// "0.4 s", "3 s", "5 min", the bench timings are under a second
function seconds(x: number): string {
  return x < 60 ? `${Number(x.toFixed(1))} s` : formatDuration(x)
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className={`truncate font-semibold text-stone-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  )
}
