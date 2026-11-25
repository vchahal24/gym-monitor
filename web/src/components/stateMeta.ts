// STATE META
// Purpose: label, colours and styling for every display status

import type { DisplayStatus } from "../types"

export interface stateMeta {
  label: string
  color: string // fill colour (brand state colour, Slide 5)
  text: string // darker shade that passes 4.5:1 on white/cream, for text
  tint: string // light tint for backgrounds
  onColor: string // text colour you can read on top of color
  description: string
}

export const STATE_META: Record<DisplayStatus, stateMeta> = {
  AVAILABLE: {
    label: "Available",
    color: "#2FA84F",
    text: "#1B7234",
    tint: "#E2F4E6",
    onColor: "#0E2416",
    description: "Free to use",
  },
  ACTIVE: {
    label: "Active",
    color: "#D64545",
    text: "#AE2C2C",
    tint: "#FBE4E4",
    onColor: "#FFFFFF",
    description: "Someone is mid-set",
  },
  RESTING: {
    label: "Resting",
    color: "#F2C94C",
    text: "#7A5A00",
    tint: "#FCF3D2",
    onColor: "#2E2300",
    description: "Between sets, still taken",
  },
  MAINTENANCE: {
    label: "Maintenance",
    color: "#F07B1F",
    text: "#A04A06",
    tint: "#FDE8D7",
    onColor: "#2B1405",
    description: "Out of service",
  },
  // darker than the untracked areas (#EDEDEB), dashed and with a signal off icon wherever its drawn
  // so it never looks like "not tracked" or maintenance
  OFFLINE: {
    label: "Offline",
    color: "#A8A29A",
    text: "#57514A",
    tint: "#ECEAE6",
    onColor: "#1F1C19",
    description: "No data from sensor",
  },
}

// shown for machines whose sensor node has gone quiet
export const OFFLINE_META = STATE_META.OFFLINE

// CSS background for MAINTENANCE, orange with diagonal hatching (not just colour)
export const MAINTENANCE_HATCH = "repeating-linear-gradient(135deg, rgb(0 0 0 / 0.16) 0 3px, transparent 3px 8px)"
