// ADMIN NAV
// Purpose: the admin sections in sidebar order

import { Activity, BarChart3, Brush, Clock, Download, Gauge, Lightbulb, Radio, SlidersHorizontal, Wrench, type LucideIcon } from "lucide-react"

export interface adminSection {
  path: string
  label: string
  icon: LucideIcon
  blurb: string
}

// admin sub pages in sidebar order, paths are relative to /admin
export const ADMIN_SECTIONS: adminSection[] = [
  { path: "overview", label: "Overview", icon: Gauge, blurb: "Key numbers and the latest notifications" },
  { path: "popularity", label: "Popularity", icon: BarChart3, blurb: "Which machines get used most" },
  { path: "investments", label: "Investments", icon: Lightbulb, blurb: "Saturated groups and what to buy or rethink" },
  { path: "peak-hours", label: "Peak hours", icon: Clock, blurb: "Busiest blocks and the 4-week trend" },
  { path: "sessions", label: "Sessions", icon: Activity, blurb: "Workout lengths, rests and sessions per day" },
  { path: "cleaning", label: "Cleaning", icon: Brush, blurb: "Zone load, alerts and the cleaning schedule" },
  { path: "maintenance", label: "Maintenance", icon: Wrench, blurb: "Take machines out of service, downtime" },
  { path: "machine-control", label: "Machine control", icon: SlidersHorizontal, blurb: "Set a machine state manually, audit log" },
  { path: "sensors", label: "Sensors", icon: Radio, blurb: "Node heartbeats and offline nodes" },
  { path: "exports", label: "Exports", icon: Download, blurb: "CSV downloads" },
]
