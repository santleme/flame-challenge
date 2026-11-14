import { useSyncExternalStore } from 'react'
import { Engine } from '../game/engine'
import type { GameState } from '../game/types'

/** single live game instance for the app session */
export const engine = new Engine()

/** re-render subscribing components every engine emit (~every tick) */
export function useGameVersion(): number {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.state.version,
  )
}

/**
 * re-render only when the selected slice changes — the selector must
 * return a primitive (or otherwise Object.is-stable) value, since
 * getSnapshot runs on every emit
 */
export function useGameSelector<T>(sel: (s: GameState) => T): T {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => sel(engine.state),
  )
}
