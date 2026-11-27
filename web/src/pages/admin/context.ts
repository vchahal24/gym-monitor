// ADMIN CONTEXT
// Purpose: what the admin shell hands down to each admin page

import { useOutletContext } from "react-router"
import type { useAdminData } from "../../hooks"
import type { computeAdminView } from "../../lib/adminView"
import type { Machine } from "../../types"

export interface adminContext {
  now: Date
  view: ReturnType<typeof computeAdminView> | null // the computed owner dashboard view (null while its loading)
  raw: ReturnType<typeof useAdminData>["data"]
  error: Error | undefined
  machines: Machine[]
  health: Machine[] | undefined
  isMock: boolean
  exportPopularity: () => void
  exportRecommendations: () => void
}

export function useAdmin(): adminContext {
  return useOutletContext<adminContext>()
}
