// STATE ICON
// Purpose: shape coded status icons so status never relies on colour alone

import { WifiOff, Wrench } from "lucide-react"
import type { DisplayStatus } from "../types"

// a different shape per status
export function StateIcon({ state, size = 16, className }: { state: DisplayStatus; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true, className, fill: "none" as const }
  switch (state) {
    case "AVAILABLE": // check mark
      return (
        <svg {...common}>
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case "ACTIVE": // activity zig-zag
      return (
        <svg {...common}>
          <path d="M1.5 8.5h3l2-5 3 9 2-4h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case "RESTING": // pause bars
      return (
        <svg {...common}>
          <rect x="4" y="3" width="2.8" height="10" rx="1" fill="currentColor" />
          <rect x="9.2" y="3" width="2.8" height="10" rx="1" fill="currentColor" />
        </svg>
      )
    case "MAINTENANCE":
      return <Wrench width={size} height={size} strokeWidth={2.4} aria-hidden className={className} />
    case "OFFLINE": // signal off
      return <WifiOff width={size} height={size} strokeWidth={2.4} aria-hidden className={className} />
  }
}
