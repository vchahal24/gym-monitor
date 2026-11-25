// REQUIRE ADMIN
// Purpose: route guard that sends you to the login page if theres no admin session

import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router"
import { useAdminSession } from "../../hooks"

// SECURITY NOTE: this is frontend only, it hides the UI but does NOT protect any data
// the backend has to enforce auth on every /api/admin/* request
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { session } = useAdminSession()
  const location = useLocation()
  if (!session) return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname)}`} replace />
  return children
}
