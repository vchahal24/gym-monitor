// APP
// Purpose: the routes, gym floor, machine pages, planner and the admin pages

import { lazy } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router"
import { RequireAdmin } from "./components/admin/RequireAdmin"
import { Layout } from "./components/Layout"
import { DataSourceProvider } from "./data/DataSourceContext"
import { HomePage } from "./pages/HomePage"
import { NotFoundPage } from "./pages/NotFoundPage"

// chart heavy pages load when needed so the gym floor opens fast on a phone
const MachinePage = lazy(() => import("./pages/MachinePage").then((m) => ({ default: m.MachinePage })))
const PlanPage = lazy(() => import("./pages/PlanPage").then((m) => ({ default: m.PlanPage })))
// all the admin pages share one chunk
function admin() {
  return import("./pages/admin")
}
const AdminLayout = lazy(() => admin().then((m) => ({ default: m.AdminLayout })))
const AdminPages = {
  overview: lazy(() => admin().then((m) => ({ default: m.OverviewPage }))),
  popularity: lazy(() => admin().then((m) => ({ default: m.PopularityPage }))),
  investments: lazy(() => admin().then((m) => ({ default: m.InvestmentsPage }))),
  "peak-hours": lazy(() => admin().then((m) => ({ default: m.PeakHoursPage }))),
  sessions: lazy(() => admin().then((m) => ({ default: m.SessionsPage }))),
  cleaning: lazy(() => admin().then((m) => ({ default: m.CleaningPage }))),
  maintenance: lazy(() => admin().then((m) => ({ default: m.MaintenancePage }))),
  "machine-control": lazy(() => admin().then((m) => ({ default: m.MachineControlPage }))),
  sensors: lazy(() => admin().then((m) => ({ default: m.SensorsPage }))),
  exports: lazy(() => admin().then((m) => ({ default: m.ExportsPage }))),
}
const AdminLoginPage = lazy(() => import("./pages/AdminLoginPage").then((m) => ({ default: m.AdminLoginPage })))

export default function App() {
  return (
    <DataSourceProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="machine/:id" element={<MachinePage />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="admin/login" element={<AdminLoginPage />} />
            <Route
              path="admin"
              element={
                <RequireAdmin>
                  <AdminLayout />
                </RequireAdmin>
              }
            >
              <Route index element={<Navigate to="overview" replace />} />
              {Object.entries(AdminPages).map(([path, Page]) => (
                <Route key={path} path={path} element={<Page />} />
              ))}
              <Route path="*" element={<Navigate to="overview" replace />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </DataSourceProvider>
  )
}
