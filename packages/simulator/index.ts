export { Simulation, type SimInput, type PostureTotals } from './src/sim'
export { InputDriver, InputCursor } from './src/input-driver'
export { classifyPosture } from './src/collision'
export {
  DEFAULT_PHYSICS,
  DEFAULT_MAX_JUMPS,
  makePhysState,
  stepEntity,
  type EntityPhysState,
} from './src/physics'
export { TICK_HZ, TICK_MS, tickToMs, msToTick } from './src/tick'
export type { Vec2, Posture, EntityState, EntityTick, PhysicsParams } from './src/types'
