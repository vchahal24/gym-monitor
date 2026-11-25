// BROWSER STORAGE
// Purpose: localStorage / sessionStorage that never throws
// private mode or blocked storage just falls back instead of crashing the page

// null when the browser wont give us storage at all
function store(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

// parsed value for key, or fallback if its missing or broken
export function readJSON<T>(key: string, fallback: T, kind: "local" | "session" = "local"): T {
  try {
    const raw = store(kind)?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

// true if it actually saved
export function writeJSON(key: string, value: unknown, kind: "local" | "session" = "local"): boolean {
  try {
    store(kind)?.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

// removes key, does nothing if storage isnt there
export function removeKey(key: string, kind: "local" | "session" = "local"): void {
  try {
    store(kind)?.removeItem(key)
  } catch {
    // nothing to remove
  }
}

// gives the user a text file to save, via a temporary object URL
export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
