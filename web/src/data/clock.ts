// CLOCKS
// Purpose: the time source for data and timers
// against the real backend its just the wall clock
// in mock mode the demo panel can speed it up (10×, 60×, 240×) or pause it, the simulation,
// countdowns and charts follow it but the header clock always shows real time

export interface clockType {
  now(): number
  getState(): clockState
  subscribe(fn: () => void): () => void
}

export interface clockState {
  speed: number
  paused: boolean
}

export const SPEEDS = [1, 10, 60, 240] as const

const REAL_STATE: clockState = { speed: 1, paused: false }

// plain wall clock
export const realClock: clockType = {
  now: () => Date.now(),
  getState: () => REAL_STATE,
  subscribe: () => () => {},
}

// sim clock, real time scaled by the speed, from the last time the speed or pause changed
export class simClockClass implements clockType {
  private baseReal: number
  private baseSim: number
  private state: clockState = REAL_STATE
  private listeners = new Set<() => void>()
  private readonly real: () => number

  constructor(real: () => number = Date.now) {
    this.real = real
    this.baseReal = this.baseSim = real()
  }

  now = (): number => (this.state.paused ? this.baseSim : this.baseSim + (this.real() - this.baseReal) * this.state.speed)

  getState = (): clockState => this.state

  setSpeed(speed: number) {
    this.rebase()
    this.update({ ...this.state, speed })
  }

  setPaused(paused: boolean) {
    this.rebase()
    this.update({ ...this.state, paused })
  }

  // back to real time, 1×, running
  reset() {
    this.baseReal = this.baseSim = this.real()
    this.update(REAL_STATE)
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  // starts counting from now so changing speed doesnt jump the sim time
  private rebase() {
    this.baseSim = this.now()
    this.baseReal = this.real()
  }

  private update(next: clockState) {
    this.state = next
    for (const l of this.listeners) l()
  }
}
