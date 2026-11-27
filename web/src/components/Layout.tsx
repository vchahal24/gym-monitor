// LAYOUT
// Purpose: the page shell, header with tabs and clock, footer and the connection indicator

import { Suspense } from "react"
import { Link, NavLink, Outlet, useLocation } from "react-router"
import { useBridge, useConnectionStatus } from "../hooks"
import { DemoButton, DemoPanel } from "./DemoPanel"
import { HeaderClock } from "./HeaderClock"
import type { bridgeStatus, connectionStatus } from "../types"

const TABS = [
  { to: "/", label: "Gym Floor" },
  { to: "/plan", label: "Plan Your Workout" },
  { to: "/admin", label: "Admin" },
]

// header with the tabs, the page, then the footer
export function Layout() {
  const status = useConnectionStatus()
  const { pathname } = useLocation()
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-mustard focus:px-3 focus:py-2 focus:text-brown"
      >
        Skip to content
      </a>
      <header className="bg-forest text-cream print:bg-white print:text-black">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-3 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mustard">
            <img src="/favicon.svg" alt="" className="size-8 sm:size-9" />
            <span>
              <span className="block font-display text-2xl leading-none tracking-wide whitespace-nowrap sm:text-3xl">Gym Monitor</span>
              <span className="hidden text-xs text-cream/75 sm:block">Live machine availability</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <HeaderClock />
            <ConnectionIndicator status={status} />
            <BridgeIndicator />
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto max-w-7xl px-2 sm:px-4 print:hidden">
          <ul className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <li key={t.to}>
                <NavLink
                  to={t.to}
                  end={t.to === "/"}
                  className={({ isActive: matched }) => {
                    const isActive = matched || (t.to === "/" && pathname.startsWith("/machine/"))
                    return `block rounded-t-lg px-4 py-2 text-sm font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-mustard ${
                      isActive ? "bg-cream text-forest" : "text-cream/85 hover:bg-white/10 hover:text-cream"
                    }`
                  }}
                >
                  {t.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-white/70 ring-1 ring-black/5" aria-busy="true" aria-label="Loading" />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="print:hidden border-t border-black/5 px-4 py-4 text-center text-xs text-stone-500">
        ENGG*4200 Wireless Sensor Networks · Group 1 · University of Guelph
        <DemoButton />
      </footer>
      <DemoPanel />
    </div>
  )
}

const BRIDGE_TEXT: Record<bridgeStatus, { text: string; dot: string; title: string }> = {
  connecting: { text: "Connecting to sensors…", dot: "bg-mustard", title: "Connecting to the bridge on the coordinator PC" },
  live: { text: "Live sensors", dot: "bg-available", title: "Bridge connected, the real sensor nodes are live" },
  "bridge-offline": { text: "Bridge offline", dot: "bg-active", title: "Can’t reach the bridge, retrying. The other machines keep running." },
  "coordinator-unplugged": { text: "Coordinator unplugged", dot: "bg-mustard", title: "The bridge is running but the USB XBee coordinator is unplugged" },
}

// hybrid mode only, the link to the real sensor nodes (Live / Bridge offline / Coordinator unplugged)
function BridgeIndicator() {
  const bridge = useBridge()
  if (!bridge) return null
  const b = BRIDGE_TEXT[bridge.status]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cream/85" role="status" title={b.title}>
      <span className={`size-2 rounded-full ${b.dot}`} aria-hidden />
      <span className="hidden sm:inline">{b.text}</span>
      <span className="sr-only sm:hidden">{b.text}</span>
    </span>
  )
}

// Live / Disconnected dot, only against the real backend (the mock should look like the real system)
function ConnectionIndicator({ status }: { status: connectionStatus }) {
  if (status === "mock") return null
  const live = status === "live"
  let text = "Disconnected"
  if (live) text = "Live"
  else if (status === "connecting") text = "Connecting…"
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cream/85" role="status">
      <span className={`size-2 rounded-full ${live ? "bg-available" : status === "connecting" ? "bg-mustard" : "bg-active"}`} aria-hidden />
      <span className="hidden sm:inline">{text}</span>
      <span className="sr-only sm:hidden">{text}</span>
    </span>
  )
}
