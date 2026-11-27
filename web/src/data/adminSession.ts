// ADMIN SESSION
// Purpose: keeps the admin token in sessionStorage (gone when the tab closes)
// SECURITY NOTE: guarding routes in the frontend is NOT real security
// in mock mode the demo login is in the bundle and anyone can open the admin pages with dev tools
// in api mode the backend MUST check the bearer token on every /api/admin/* call, the route guard just keeps the UI tidy

import { readJSON, removeKey, writeJSON } from "../lib/storage"

const KEY = "gym-monitor.admin-session"

interface Session {
  token: string
  username: string
}

let session: Session | null = readJSON<Session | null>(KEY, null, "session")
const listeners = new Set<() => void>()

// the current session + a way to listen for login / logout
export const adminSession = {
  get: () => session,
  set(next: Session | null) {
    session = next
    if (next) writeJSON(KEY, next, "session")
    else removeKey(KEY, "session")
    for (const l of listeners) l()
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}
