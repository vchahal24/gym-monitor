// DEMO PANEL
// Purpose: the mock mode demo controls, speed, scenarios, pause and reset

import { FlaskConical, Pause, Play, RotateCcw, X } from "lucide-react"
import { useEffect, useState } from "react"
import { SPEEDS } from "../data/clock"
import { useDemo, useMachines, useNow } from "../hooks"
import { formatClockLine, formatTimer } from "../lib/format"
import { restingCountdownSeconds } from "../lib/remaining"

const TREADMILL_FALLBACK = "TM01"

// demo controls (mock mode only), hidden until you press Shift+D or the footer button
// doesnt need a login, normal manual control is still admin only
export function DemoPanel() {
  const demo = useDemo()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!demo) return
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    function toggle() {
      return setOpen((o) => !o)
    }
    window.addEventListener("gym-monitor:demo-toggle", toggle)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("gym-monitor:demo-toggle", toggle)
    }
  }, [demo])

  if (!demo || !open) return null
  return <Panel demo={demo} onClose={() => setOpen(false)} />
}

// footer button that opens the panel (mock mode only)
export function DemoButton() {
  const demo = useDemo()
  if (!demo) return null
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("gym-monitor:demo-toggle"))}
      className="ml-2 inline-flex items-center gap-1 rounded-full border border-stone-300 px-2 py-0.5 text-[11px] font-semibold text-stone-600 hover:bg-white focus-visible:outline-2 focus-visible:outline-forest"
      title="Demo controls (Shift+D)"
    >
      <FlaskConical size={12} aria-hidden /> Demo controls
    </button>
  )
}

// the panel itself, only made once its opened
function Panel({ demo, onClose }: { demo: NonNullable<ReturnType<typeof useDemo>>; onClose: () => void }) {
  const now = useNow(1000)
  const { machines } = useMachines()
  const [log, setLog] = useState<string | null>(null)
  const byID = new Map(machines.map((m) => [m.id, m]))
  const le01 = byID.get("LE01")
  const lp01 = byID.get("LP01")
  const bc01 = byID.get("BC01")
  const brokenTreadmill = machines.find((m) => m.kind === "treadmill" && m.maintenance?.reason.endsWith("(demo)"))
  const treadmill = brokenTreadmill ?? machines.find((m) => m.kind === "treadmill" && !m.maintenance) ?? byID.get(TREADMILL_FALLBACK)
  const countdown = lp01 ? restingCountdownSeconds(lp01, now) : null
  const c = demo.controls
  function say(t: string) {
    return setLog(t)
  }

  const scenarios: { label: string; hint: string; run: () => void; disabled?: boolean }[] = [
    {
      label: "Someone starts on LP01",
      hint: "LP01 goes Active and a normal session plays out",
      run: () => (c.startSession("LP01"), say("LP01: someone started a session.")),
      disabled: !!lp01?.maintenance || lp01?.online === false,
    },
    {
      label: "LP01 resting → leaves",
      hint: "Resting now, free after the 5-minute timeout",
      run: () => (c.leave("LP01"), say("LP01 is resting; watch the countdown on the map.")),
      disabled: !!lp01?.maintenance || lp01?.online === false,
    },
    { label: "Evening rush", hint: "Most free machines get someone at once", run: () => say(`Evening rush: ${c.rush()} machines just got busy.`) },
    {
      label: "Quiet morning",
      hint: "Everyone finishes; nobody new for an hour",
      run: () => (c.quiet(60), say("Quiet: machines free up over the next 5 minutes.")),
    },
    {
      label: le01?.online === false ? "Node LE01 back online" : "Node LE01 goes offline",
      hint: "The live sensor stops sending packets",
      run: () => {
        const off = le01?.online !== false
        c.setOnline("LE01", !off)
        say(off ? "LE01 offline: grey and dashed on the map, “No data from sensor”." : "LE01 is back online; its first packet re-syncs the state.")
      },
    },
    {
      label: bc01?.online === false ? "Biceps curl node back online" : "Biceps curl node goes offline",
      hint: "BC01 drops out of live counts, history and the planner",
      run: () => {
        const off = bc01?.online !== false
        c.setOnline("BC01", !off)
        say(
          off
            ? "BC01 offline: “No data from sensor” on the map, left out of live counts and heatmaps, and the planner swaps biceps curl for preacher curl."
            : "BC01 is back online and counted again.",
        )
      },
    },
    {
      label: brokenTreadmill ? `Fix ${brokenTreadmill.name}` : "Treadmill breaks",
      hint: "Into maintenance: hatched and frozen on the map",
      run: () => {
        if (!treadmill) return
        if (brokenTreadmill) {
          c.setMaintenance(brokenTreadmill.id, null)
          say(`${brokenTreadmill.name} is back in service.`)
        } else {
          c.setMaintenance(treadmill.id, "Belt snapped mid-run (demo)")
          say(`${treadmill.name} is out of service.`)
        }
      },
    },
  ]

  return (
    <aside
      aria-label="Demo controls"
      className="fixed right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl bg-white shadow-xl ring-1 ring-black/10 print:hidden"
    >
      <div className="flex items-center justify-between rounded-t-xl bg-brown px-3 py-2 text-cream">
        <h2 className="flex items-center gap-1.5 font-display text-xl tracking-wide">
          <FlaskConical size={16} aria-hidden /> Demo controls
        </h2>
        <span className="text-[11px] text-cream/70">mock only · Shift+D</span>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-white/15" aria-label="Close demo controls">
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
        <div className="rounded-lg bg-cream px-3 py-2">
          <p className="text-[11px] font-bold tracking-wide text-stone-500 uppercase">Simulation time</p>
          <p className="font-semibold tabular-nums text-stone-900">{formatClockLine(now)}</p>
          {countdown !== null && <p className="text-xs text-stone-700">LP01 free in ≤ {formatTimer(countdown)} if no movement</p>}
          <p className="mt-0.5 text-[11px] text-stone-500">The header clock stays on real time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-cream p-0.5 ring-1 ring-stone-200" role="group" aria-label="Simulation speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={demo.speed === s}
                onClick={() => demo.setSpeed(s)}
                className={`rounded-md px-2.5 py-1 text-sm font-bold tabular-nums ${demo.speed === s ? "bg-forest text-cream" : "text-stone-700 hover:bg-white"}`}
              >
                {s}×
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => demo.setPaused(!demo.paused)}
            className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-sm font-semibold hover:bg-cream"
          >
            {demo.paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />} {demo.paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={demo.reset}
            className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-sm font-semibold hover:bg-cream"
            title="Start a fresh simulation at real time, 1×"
          >
            <RotateCcw size={14} aria-hidden /> Reset
          </button>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-bold tracking-wide text-stone-500 uppercase">Scenarios</p>
          <ul className="grid grid-cols-2 gap-1.5">
            {scenarios.map((s) => (
              <li key={s.hint}>
                <button
                  type="button"
                  onClick={s.run}
                  disabled={s.disabled || demo.paused}
                  title={s.hint}
                  className="h-full w-full rounded-lg bg-forest/5 px-2 py-1.5 text-left text-xs font-semibold text-forest ring-1 ring-forest/20 hover:bg-forest/10 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-forest"
                >
                  {s.label}
                  <span className="block text-[10px] font-normal text-stone-600">{s.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {log && (
          <p role="status" className="rounded-md bg-[#E2F4E6] px-2.5 py-1.5 text-xs font-semibold text-[#1B7234]">
            {log}
          </p>
        )}
      </div>
    </aside>
  )
}
