// GYM FLOOR PAGE
// Purpose: the home page, summary, map, filters, heatmap and the live feed

import { useState } from "react"
import { useSearchParams } from "react-router"
import { ActivityFeed } from "../components/ActivityFeed"
import { ClosedBanner } from "../components/ClosedBanner"
import { Card } from "../components/Card"
import { Filters } from "../components/Filters"
import { EMPTY_FILTER, matchesFilter, type filterValue } from "../lib/filter"
import { FloorMap } from "../components/FloorMap"
import { Heatmap } from "../components/Heatmap"
import { MachineList } from "../components/MachineList"
import { MachinePanel } from "../components/MachinePanel"
import { UntrackedPanel } from "../components/UntrackedPanel"
import { UNTRACKED_AREAS, type fixtureKind } from "../config/gym-layout"
import { StatCards } from "../components/StatCards"
import { useEvents, useHeatmap, useMachines, useNow, useSummary } from "../hooks"

export function HomePage() {
  const now = useNow(1000)
  const { machines, loading, error } = useMachines()
  const { summary, busiestToday } = useSummary()
  const { heatmap } = useHeatmap()
  const events = useEvents(15)
  const [filter, setFilter] = useState<filterValue>(EMPTY_FILTER)
  const [params, setParams] = useSearchParams()
  const selected = params.get("m")
  const areaParam = params.get("area") as fixtureKind | null
  const area = areaParam && areaParam in UNTRACKED_AREAS ? areaParam : null

  function select(id: string | null) {
    return setParams(id ? { m: id } : {}, { replace: true, preventScrollReset: true })
  }
  function selectArea(kind: fixtureKind | null) {
    return setParams(kind ? { area: kind } : {}, { replace: true, preventScrollReset: true })
  }
  const visible = machines.filter((m) => matchesFilter(m, filter))

  if (error) {
    return (
      <div role="alert" className="rounded-xl bg-white p-6 text-stone-800 ring-1 ring-active/30">
        <h1 className="font-display text-3xl text-active">Can't reach the gym</h1>
        <p className="mt-2 text-sm">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Gym floor</h1>
      <ClosedBanner
        now={now}
        detail={
          machines.some((m) => m.sensor)
            ? "Simulated machines are idle while the gym is closed. The live sensors keep reporting, so their activity still shows."
            : "No machines are in use while the gym is closed. Today's numbers are shown below."
        }
      />
      <StatCards summary={summary} busiestToday={busiestToday} now={now} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card title="Gym floor" headingID="floor-title" bodyClassName="p-3 sm:p-4">
            <div className="mb-3">
              <Filters value={filter} onChange={setFilter} machines={machines} />
            </div>
            {loading ? (
              <div className="aspect-[124/89] w-full animate-pulse rounded-xl bg-stone-100" aria-busy="true" />
            ) : (
              // on phones the plan keeps a readable size and scrolls sideways inside the card
              <div className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
                <div className="min-w-[860px] sm:min-w-0">
                  <FloorMap
                    machines={machines}
                    now={now}
                    selectedID={selected}
                    isVisible={(m) => matchesFilter(m, filter)}
                    onSelect={(id) => select(id === selected ? null : id)}
                    selectedArea={area}
                    onSelectArea={(kind) => selectArea(kind === area ? null : kind)}
                  />
                </div>
              </div>
            )}
            <p className="mt-1 text-xs text-stone-500 sm:hidden">Swipe sideways to see the whole floor.</p>
            <p className="mt-2 text-xs text-stone-500">
              Select a machine for details. Machines with a <span className="font-semibold text-forest">LIVE</span> badge carry the prototype ESP32 + XBee
              sensor. Grey areas aren't tracked.
            </p>
          </Card>

          <Card title="Machines" headingID="list-title" bodyClassName="p-3 sm:p-4">
            <MachineList machines={visible} now={now} />
          </Card>

          <Card title="Weekly usage, whole gym" headingID="heatmap-title">
            <Heatmap heatmap={heatmap} now={now} caption="Share of the gym's machines in use for each weekday and two-hour block, averaged over recent weeks" />
          </Card>
        </div>

        <aside className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:self-start" aria-label="Machine details and activity">
          {selected && <MachinePanel id={selected} now={now} onClose={() => select(null)} />}
          {area && <UntrackedPanel kind={area} onClose={() => selectArea(null)} />}
          <Card title="Live activity" headingID="feed-title" bodyClassName="max-h-[34rem] overflow-y-auto">
            <ActivityFeed events={events} machines={machines} now={now} />
          </Card>
        </aside>
      </div>
    </div>
  )
}
