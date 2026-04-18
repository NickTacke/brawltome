export type Vec2 = { x: number; y: number }

// Which surface (if any) the entity is currently resting on, used for the
// primary sim metric: air/ground/wall time per entity.
export type Posture = 'air' | 'ground' | 'wall'

export type EntityState = {
  id: number
  team: number
  pos: Vec2
  vel: Vec2
  facing: -1 | 1
  posture: Posture
  alive: boolean
}

// Snapshot of one entity at one tick; emitted by the simulator for external
// stat aggregation (positioning time, movement counts, etc.).
export type EntityTick = {
  tick: number
  ms: number
  entity: EntityState
}

// Which attack button was pressed. "light"/"heavy"/"dodge"/"throw" mirror
// the four InputFlag bits (Light/Heavy/DodgeDash/PickUpThrow). Edge-triggered
// by Simulation, so holding the button yields a single event on press.
export type AttackButton = 'light' | 'heavy' | 'dodge' | 'throw'

// Directional context at the moment of the press. Vertical (AimUp, Drop)
// dominates over horizontal so that e.g. Up+Right+Light still reads as 'up'.
// This matches the in-engine precedence used for picking sig vs aerial.
export type AttackDirection = 'neutral' | 'up' | 'down' | 'side'

// One attack-button press event. Damage and hitbox resolution come later;
// for now these are "attempts" that downstream stats consumers can count.
export type AttackAttempt = {
  tick: number
  ms: number
  entityId: number
  button: AttackButton
  direction: AttackDirection
  posture: Posture
}

// Brawlhalla's per-legend attribute scaling rolls up into these derived
// physics params. Filled by the caller (from game-data) and passed into the
// simulator so we don't hard-code per-legend values here.
export type PhysicsParams = {
  // Baseline horizontal velocity cap (units/second at speed stat 5).
  walkSpeed: number
  // Jump initial velocity (units/second, upward positive-in-world means
  // negative-y in screen space; Brawlhalla uses y-down).
  jumpImpulse: number
  // Gravity acceleration, units/second^2.
  gravity: number
  // Max fall speed.
  maxFallSpeed: number
  // Per-tick multiplicative decay applied to horizontal velocity on the
  // ground when no directional input is held. BMG's engine uses a friction
  // coefficient here rather than snapping velocity to zero.
  groundFriction: number
}
