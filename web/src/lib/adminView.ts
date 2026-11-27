// OWNER DASHBOARD VIEW
// Purpose: works out every number the admin pages show, in one go from the stats and events

// config + types
import { KIND_LABELS } from "../config/gym-layout"
import { MACHINE_GROUPS, type Heatmap, type Machine, type MachineStats, type StateEvent } from "../types"
import {
  avgWorkoutByGroup,
  buildOccupancyGrid,
  kindSummary,
  popularity,
  recommendations,
  restInsights,
  saturationByBlock,
  saturationOver,
  sessionsPerDayTotal,
  weeklyTrend,
  type machineInfo,
} from "./admin"

// other lib pieces
import { historyExclusions } from "./eligibility"
import { deriveSessions } from "./sessions"
import { addDays, startOfWeek } from "./time"

export interface adminInput {
  stats: MachineStats[]
  events: StateEvent[]
  heatmap: Heatmap
  machines: Machine[]
  at: number // when the data was fetched, epoch ms
}

// everything the owner dashboard shows, from the raw stats + events
export function computeAdminView(data: adminInput) {
  const at = data.at
  const info: machineInfo[] = data.machines.map((m) => ({ id: m.id, name: m.name, group: m.group, kind: m.kind }))
  const ids = info.map((m) => m.id)
  const rows = popularity(info, data.stats, at)
  // maintenance and offline time are both left out of the occupancy grid
  const downtime = data.stats.flatMap((s) => historyExclusions(s.machineId, s.maintenanceHistory, s.offlineHistory ?? [], at))
  const from = addDays(startOfWeek(new Date(at)), -21).getTime()
  const grid = buildOccupancyGrid(data.events, ids, downtime, from, at)
  const maintNow = new Set(data.machines.filter((m) => m.maintenance).map((m) => m.id))

  const groups = MACHINE_GROUPS.map((g) => {
    const gids = info.filter((m) => m.group === g).map((m) => m.id)
    return {
      group: g,
      values: saturationByBlock(grid, gids),
      weekdayEvening: saturationOver(grid, gids, (d, b) => d < 5 && b === 5),
      operational: gids.filter((id) => !maintNow.has(id)).length,
    }
  })
  const kinds = kindSummary(info, rows, grid)
  const incidents = new Map(data.stats.map((s) => [s.machineId, s.maintenanceHistory.length]))
  const recs = recommendations(info, rows, grid, (k) => KIND_LABELS[k], incidents)

  const sessions = deriveSessions(data.events).filter((s) => Date.parse(s.start) >= at - 28 * 86_400_000)
  return {
    rows,
    groups,
    kinds,
    recs,
    trend: weeklyTrend(grid, new Date(at), 4),
    byGroup: avgWorkoutByGroup(sessions, info),
    perDay: sessionsPerDayTotal(data.stats),
    rests: restInsights(data.events, sessions),
    heatmap: data.heatmap,
  }
}
