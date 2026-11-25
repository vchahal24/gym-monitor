// MACHINE TILE
// Purpose: a machine icon on its status colour, same as on the floor map

import { WifiOff, Wrench } from "lucide-react"
import { displayStatus } from "../lib/machine"
import type { Machine } from "../types"
import { MachineIcon } from "./icons/MachineIcon"
import { MAINTENANCE_HATCH, STATE_META } from "./stateMeta"

// the machines icon on a status coloured square like on the floor map, decorative only
export function MachineTile({ machine, size = 44 }: { machine: Pick<Machine, "kind" | "state" | "maintenance" | "online">; size?: number }) {
  const status = displayStatus(machine)
  const meta = STATE_META[status]
  const offline = status === "OFFLINE"
  return (
    <span
      className={`state-fade relative inline-flex shrink-0 items-center justify-center rounded-lg ${offline ? "border-2 border-dashed border-black/45" : ""}`}
      style={{
        width: size,
        height: size,
        backgroundColor: meta.color,
        backgroundImage: status === "MAINTENANCE" ? MAINTENANCE_HATCH : undefined,
        color: meta.onColor,
      }}
      aria-hidden="true"
    >
      <MachineIcon kind={machine.kind} size={Math.round(size * 0.8)} />
      {status === "MAINTENANCE" && (
        <span className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-white text-[#A04A06] ring-2 ring-[#F07B1F]">
          <Wrench size={11} strokeWidth={2.6} />
        </span>
      )}
      {offline && (
        <span className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-white text-[#4A443E] ring-2 ring-[#8C847A]">
          <WifiOff size={11} strokeWidth={2.6} />
        </span>
      )}
    </span>
  )
}
