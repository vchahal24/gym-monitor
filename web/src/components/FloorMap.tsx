// FLOOR MAP
// Purpose: the top down SVG map of the gym with every machine as a status coloured tile

import { Lock, WifiOff, Wrench } from "lucide-react"
import type { KeyboardEvent, ReactNode } from "react"
import {
  ENTRANCE,
  FLOOR,
  FLOOR_FIXTURES,
  FLOOR_ZONES,
  GROUP_STYLE,
  GYM_LAYOUT,
  TILE,
  UNTRACKED_AREAS,
  WINDOWS,
  isUntracked,
  type fixtureKind,
  type floorFixture,
  type machineLayout,
} from "../config/gym-layout"
import { formatDuration, formatTimer } from "../lib/format"
import { displayStatus, liveCounts } from "../lib/eligibility"
import { restingCountdownSeconds } from "../lib/remaining"
import type { Machine } from "../types"
import { MachineIcon } from "./icons/MachineIcon"
import { STATE_META } from "./stateMeta"

interface floorMapProps {
  machines: Machine[]
  now: Date
  selectedID: string | null
  isVisible: (m: Machine) => boolean // machines that match the current filters, the others get dimmed
  onSelect: (id: string) => void
  selectedArea?: fixtureKind | null // untracked area (free weights, stretching) currently open, if any
  onSelectArea?: (kind: fixtureKind) => void
}

const WALL = "#3E2A20"
const WALL_W = 6
const FIXTURE_FILL = "#ECE4D6"
const FIXTURE_INK = "#6F604F"

// top down SVG plan of the gym, every machine is a status coloured tile
export function FloorMap({ machines, now, selectedID: selectedID, isVisible, onSelect, selectedArea = null, onSelectArea }: floorMapProps) {
  const byID = new Map(machines.map((m) => [m.id, m]))
  const { width: W, height: H } = FLOOR
  const doorL = ENTRANCE.x
  const doorR = ENTRANCE.x + ENTRANCE.width

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full select-none"
      role="group"
      aria-label="Gym floor map. Use Tab to move between machines and Enter to open one."
    >
      <defs>
        <pattern id="hatch" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
          <rect width="4" height="10" fill="rgb(0 0 0 / 0.2)" />
        </pattern>
      </defs>

      {/* floor */}
      <rect x={0} y={0} width={W} height={H} rx={14} fill="#FFFDF8" />
      {/* walls with an entrance gap on the bottom wall */}
      <path
        d={`M${doorL} ${H - WALL_W / 2} H${WALL_W / 2} V${WALL_W / 2} H${W - WALL_W / 2} V${H - WALL_W / 2} H${doorR}`}
        fill="none"
        stroke={WALL}
        strokeWidth={WALL_W}
        strokeLinejoin="round"
      />
      <g aria-hidden="true">
        {/* windows along the bottom (street front) wall */}
        {WINDOWS.map((w) => (
          <g key={w.x}>
            <rect x={w.x} y={H - WALL_W - 2} width={w.width} height={WALL_W + 2} fill="#BFE0F2" stroke="#6FA9C9" strokeWidth={1.5} />
            <path d={`M${w.x + w.width / 2} ${H - WALL_W - 2} v${WALL_W + 2}`} stroke="#6FA9C9" strokeWidth={1.5} />
          </g>
        ))}
        <text x={(doorL + doorR) / 2} y={H - 14} textAnchor="middle" fontSize={14} fontWeight={700} fill="#7A6A5C" letterSpacing={2}>
          ENTRANCE
        </text>
        <path d={`M${(doorL + doorR) / 2} ${H - 36} l-7 9 h14 z`} fill="#7A6A5C" />
      </g>

      {/* zones */}
      <g aria-hidden="true">
        {FLOOR_ZONES.map((z) => {
          const st = GROUP_STYLE[z.group]
          // zone stats, free out of the machines that are reporting (offline and maintenance left out)
          const c = liveCounts(machines.filter((m) => m.zoneId === z.id))
          return (
            <g key={z.label}>
              <rect x={z.x} y={z.y} width={z.width} height={z.height} rx={12} fill={st.tint} stroke={st.edge} strokeWidth={1.5} />
              <text x={z.x + 14} y={z.y + 20} fontSize={12.5} fontWeight={800} fill={st.ink} letterSpacing={1}>
                {z.label.toUpperCase()}
              </text>
              {c.total > 0 && (
                <text
                  x={z.x + z.width - 12}
                  y={z.y + 20}
                  textAnchor="end"
                  fontSize={11.5}
                  fontWeight={700}
                  fill={st.ink}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {c.reporting ? `${c.available}/${c.reporting} free` : "no data"}
                </text>
              )}
            </g>
          )
        })}
        {FLOOR_FIXTURES.filter((f) => !isUntracked(f.kind)).map((f, i) => (
          <Fixture key={i} f={f} />
        ))}
      </g>

      {/* untracked areas, you can click them but they only explain why theres no data */}
      {FLOOR_FIXTURES.filter((f) => isUntracked(f.kind)).map((f) => (
        <UntrackedArea key={f.kind} f={f} selected={selectedArea === f.kind} onSelect={onSelectArea} />
      ))}

      {/* machines */}
      {GYM_LAYOUT.map((layout) => {
        const m = byID.get(layout.id)
        if (!m) return null
        return (
          <MachineShape key={layout.id} layout={layout} machine={m} now={now} selected={selectedID === layout.id} dimmed={!isVisible(m)} onSelect={onSelect} />
        )
      })}
    </svg>
  )
}

// one machine tile, with its icon, ID, badges and countdown
function MachineShape({
  layout,
  machine,
  now,
  selected,
  dimmed,
  onSelect,
}: {
  layout: machineLayout
  machine: Machine
  now: Date
  selected: boolean
  dimmed: boolean
  onSelect: (id: string) => void
}) {
  const { x, y } = layout
  const s = TILE
  const half = s / 2
  const status = displayStatus(machine)
  const maint = status === "MAINTENANCE"
  const offline = status === "OFFLINE"
  const meta = STATE_META[status]
  const countdown = offline || maint ? null : restingCountdownSeconds(machine, now)
  const forTime = formatDuration((now.getTime() - Date.parse(machine.since)) / 1000)

  let statusText: string
  if (maint) statusText = `out of service: ${machine.maintenance?.reason}`
  else if (offline) statusText = "offline, no data from sensor"
  else if (countdown !== null) statusText = `${meta.label} for ${forTime}, free in at most ${formatTimer(countdown)} if no movement`
  else statusText = `${meta.label} for ${forTime}`
  const held = machine.override?.mode === "hold" && !maint
  if (held) statusText += ", held by staff"
  const label = `${machine.id} ${machine.name}: ${statusText}${layout.prototype ? ", live sensor" : ""}`

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onSelect(machine.id)
    }
  }

  return (
    <g
      className="machine"
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onSelect(machine.id)}
      onKeyDown={onKey}
      opacity={dimmed ? 0.22 : 1}
      style={{ transition: "opacity 200ms" }}
    >
      <title>{label}</title>
      {status === "ACTIVE" && !offline && !dimmed && (
        <rect className="machine-pulse" x={x - half} y={y - half} width={s} height={s} rx={12} fill="none" stroke={meta.color} strokeWidth={4} />
      )}
      {/* focus ring (keyboard) */}
      <rect
        className="machine-focus"
        x={x - half - 8}
        y={y - half - 8}
        width={s + 16}
        height={s + 16}
        rx={16}
        fill="none"
        stroke="#0B4A2E"
        strokeWidth={3}
        strokeDasharray="5 4"
      />
      {/* selection ring */}
      {selected && <rect x={x - half - 5} y={y - half - 5} width={s + 10} height={s + 10} rx={15} fill="none" stroke="#0B4A2E" strokeWidth={4} />}
      <rect
        className="machine-body state-fade"
        x={x - half}
        y={y - half}
        width={s}
        height={s}
        rx={11}
        style={{ fill: meta.color }}
        stroke={offline ? "#3F3A35" : "rgb(0 0 0 / 0.28)"}
        strokeWidth={offline ? 2.5 : 1.5}
        strokeDasharray={offline ? "7 5" : undefined}
      />
      {maint && <rect x={x - half} y={y - half} width={s} height={s} rx={11} fill="url(#hatch)" style={{ pointerEvents: "none" }} />}
      <g color={meta.onColor} className="state-fade" style={{ pointerEvents: "none" }} opacity={offline ? 0.55 : 1}>
        <MachineIcon kind={layout.kind} x={x - 24} y={y - half + 2} size={48} strokeWidth={2.6} />
        <text x={x} y={y + half - 8} textAnchor="middle" fontSize={16} fontWeight={800} fill="currentColor">
          {machine.id}
        </text>
      </g>
      {offline ? (
        <text x={x} y={y + half + 14} textAnchor="middle" fontSize={10} fontWeight={700} fontStyle="italic" fill="#57514A" style={{ pointerEvents: "none" }}>
          No data from sensor
        </text>
      ) : (
        <text x={x} y={y + half + 15} textAnchor="middle" fontSize={12} fontWeight={600} fill="#3B2A20" style={{ pointerEvents: "none" }}>
          {layout.label}
        </text>
      )}

      {layout.prototype && <LiveBadge x={x - half - 10} y={y - half - 10} />}
      {maint && <CornerBadge x={x + half} y={y - half} ring="#F07B1F" ink="#A04A06" icon={<Wrench x={-7} y={-7} size={14} strokeWidth={2.6} />} />}
      {offline && <CornerBadge x={x + half} y={y - half} ring="#8C847A" ink="#4A443E" icon={<WifiOff x={-7} y={-7} size={14} strokeWidth={2.6} />} />}
      {held && <CornerBadge x={x + half} y={y + half - 8} ring="#0B4A2E" ink="#0B4A2E" icon={<Lock x={-7} y={-7} size={14} strokeWidth={2.6} />} />}
      {countdown !== null && <CountdownPill x={x + half} y={y - half} text={`≤${formatTimer(countdown)}`} />}
    </g>
  )
}

// small round badge on a tiles corner (lock, wrench, signal off)
function CornerBadge({ x, y, ring, ink, icon }: { x: number; y: number; ring: string; ink: string; icon: ReactNode }) {
  return (
    <g transform={`translate(${x - 4} ${y + 4})`} style={{ pointerEvents: "none" }} aria-hidden="true" color={ink}>
      <circle r={12} fill="#FFFFFF" stroke={ring} strokeWidth={2.5} />
      {icon}
    </g>
  )
}

// the resting countdown under a tile
function CountdownPill({ x, y, text }: { x: number; y: number; text: string }) {
  const w = 46
  return (
    <g transform={`translate(${x - w + 12} ${y - 11})`} style={{ pointerEvents: "none" }} aria-hidden="true">
      <rect width={w} height={20} rx={10} fill="#2E2300" stroke="#FFFDF8" strokeWidth={1.5} />
      <text x={w / 2} y={14.5} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="#F2C94C" style={{ fontVariantNumeric: "tabular-nums" }}>
        {text}
      </text>
    </g>
  )
}

// the "live sensor" mark on the prototype nodes
function LiveBadge({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} style={{ pointerEvents: "none" }} aria-hidden="true">
      <rect width={44} height={20} rx={10} fill="#0B4A2E" stroke="#FFFDF8" strokeWidth={2} />
      <circle cx={10} cy={10} r={3.5} fill="#E8A33D" />
      <text x={17} y={14.5} fontSize={10.5} fontWeight={700} fill="#FBF7EF">
        LIVE
      </text>
    </g>
  )
}

const UNTRACKED_FILL = "#EDEDEB"
const UNTRACKED_EDGE = "#C9C7C2"

// free weights / stretching, neutral grey with no status colour, opens an explanation
function UntrackedArea({ f, selected, onSelect }: { f: floorFixture; selected: boolean; onSelect?: (kind: fixtureKind) => void }) {
  const info = UNTRACKED_AREAS[f.kind]!
  const label = `${info.title}: not tracked. Select for why there's no data.`
  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onSelect?.(f.kind)
    }
  }
  return (
    <g className="machine untracked" role="button" tabIndex={0} aria-label={label} aria-pressed={selected} onClick={() => onSelect?.(f.kind)} onKeyDown={onKey}>
      <title>{label}</title>
      <rect
        className="machine-focus"
        x={f.x - 5}
        y={f.y - 5}
        width={f.width + 10}
        height={f.height + 10}
        rx={16}
        fill="none"
        stroke="#0B4A2E"
        strokeWidth={3}
        strokeDasharray="5 4"
      />
      <g aria-hidden="true">
        <Fixture f={f} fill={UNTRACKED_FILL} edge={selected ? "#57534E" : UNTRACKED_EDGE} edgeWidth={selected ? 3.5 : 1.5} />
        {/* narrow areas get the pill under the box so it doesnt cover the label */}
        <g transform={f.width < 260 ? `translate(${f.x + f.width - 84} ${f.y + f.height + 5})` : `translate(${f.x + f.width - 92} ${f.y + 8})`}>
          <rect width={84} height={20} rx={10} fill="#FFFFFF" stroke={UNTRACKED_EDGE} />
          <text x={42} y={14} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#6B6762" letterSpacing={0.5}>
            NOT TRACKED
          </text>
        </g>
      </g>
    </g>
  )
}

// non-machine features. Only the untracked areas are interactive (see UntrackedArea)
function Fixture({ f, fill = "#F1ECE3", edge = "#DDD2C0", edgeWidth = 1.5 }: { f: floorFixture; fill?: string; edge?: string; edgeWidth?: number }) {
  const cx = f.x + f.width / 2
  function label(y: number) {
    return (
      <text x={cx} y={y} textAnchor="middle" fontSize={13} fontWeight={700} fill={FIXTURE_INK} letterSpacing={1}>
        {f.label.toUpperCase()}
      </text>
    )
  }
  switch (f.kind) {
    case "free-weights": {
      // dumbbell rack along the back wall plus a grid of flat benches
      const n = Math.floor((f.width - 60) / 38)
      const bells = Array.from({ length: n }, (_, i) => f.x + (f.width - (n - 1) * 38) / 2 + i * 38)
      const cols = Math.max(1, Math.floor((f.width - 30) / 70))
      const rows = Math.max(1, Math.floor((f.height - 100) / 110))
      const gapX = (f.width - cols * 34) / (cols + 1)
      const benches = Array.from({ length: cols * rows }, (_, i) => ({ x: f.x + gapX + (i % cols) * (34 + gapX), y: f.y + 90 + Math.floor(i / cols) * 110 }))
      return (
        <g>
          <rect x={f.x} y={f.y} width={f.width} height={f.height} rx={12} fill={fill} stroke={edge} strokeWidth={edgeWidth} />
          {label(f.y + 22)}
          <rect x={f.x + 18} y={f.y + 34} width={f.width - 36} height={22} rx={4} fill="#E2E1DE" stroke="#C4C1BB" />
          {bells.map((bx) => (
            <g key={bx} stroke="#77736E" strokeWidth={3} strokeLinecap="round">
              <path d={`M${bx - 9} ${f.y + 45}h18`} />
              <path d={`M${bx - 9} ${f.y + 39}v12M${bx + 9} ${f.y + 39}v12`} strokeWidth={4} />
            </g>
          ))}
          {benches.map((b) => (
            <g key={`${b.x}:${b.y}`}>
              <rect x={b.x} y={b.y} width={34} height={74} rx={8} fill="#E2E1DE" stroke="#C4C1BB" />
              <rect x={b.x + 4} y={b.y + 4} width={26} height={26} rx={6} fill="#D6D4D0" />
            </g>
          ))}
        </g>
      )
    }
    case "stretching": {
      // mats in a grid that fits the area
      const cols = Math.max(1, Math.floor((f.width - 16) / 58))
      const rows = Math.max(1, Math.floor((f.height - 30) / 58))
      const left = f.x + (f.width - (cols * 58 - 14)) / 2
      return (
        <g>
          <rect x={f.x} y={f.y} width={f.width} height={f.height} rx={12} fill={fill} stroke={edge} strokeWidth={edgeWidth} />
          {Array.from({ length: cols * rows }, (_, i) => (
            <rect key={i} x={left + (i % cols) * 58} y={f.y + 32 + Math.floor(i / cols) * 58} width={44} height={46} rx={5} fill="#DEDCD8" stroke="#C4C1BB" />
          ))}
          {label(f.y + 20)}
        </g>
      )
    }
    case "front-desk":
      return (
        <g>
          <path d={`M${f.x} ${f.y + f.height} V${f.y} H${f.x + f.width} V${f.y + f.height}`} fill={FIXTURE_FILL} stroke="#B9A88F" strokeWidth={2} />
          {label(f.y + f.height / 2 + 5)}
        </g>
      )
    case "water":
      return (
        <g>
          <circle cx={cx} cy={f.y + f.height / 2} r={f.width / 2} fill="#DCEEF8" stroke="#6FA9C9" strokeWidth={2} />
          <path d={`M${cx} ${f.y + 9} c5 7 8 11 8 15 a8 8 0 0 1 -16 0 c0 -4 3 -8 8 -15z`} fill="#4F86A6" />
          <text x={cx} y={f.y + f.height + 15} textAnchor="middle" fontSize={11} fontWeight={700} fill="#4F86A6">
            WATER
          </text>
        </g>
      )
    case "change-room":
      return (
        <g>
          <rect x={f.x} y={f.y} width={f.width} height={f.height} rx={6} fill={FIXTURE_FILL} stroke="#B9A88F" strokeWidth={2} />
          {/* door gap on the right side, facing the entrance */}
          <path d={`M${f.x + f.width} ${f.y + 24} v${f.height - 48}`} stroke="#FFFDF8" strokeWidth={4} />
          <path
            d={`M${f.x + f.width} ${f.y + 24} a${f.height - 48} ${f.height - 48} 0 0 0 ${-(f.height - 48)} ${f.height - 48}`}
            fill="none"
            stroke="#B9A88F"
            strokeDasharray="3 3"
          />
          {label(f.y + f.height / 2 + 5)}
        </g>
      )
  }
}
