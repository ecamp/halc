import type { ReactivityAdapter, Signal } from './adapters.js'

const constantSignal: Signal<number> = Object.freeze({ value: 0 })

/** Reactivity for environments where nobody listens to changes: workers, Node and tests. */
export const noopReactivity: ReactivityAdapter = Object.freeze({
  signal: () => constantSignal,
  bump: () => undefined,
  track: () => undefined,
})
