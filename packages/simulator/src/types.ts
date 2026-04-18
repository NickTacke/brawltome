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
  // Accumulated damage percent. Feeds knockback scaling: outgoing hits
  // launch harder the more damage the defender has taken. Reset to 0 on
  // respawn. Capped at 700 per the game source.
  damagePct: number
  // Absolute ms at which the entity's input lock (from hitstun) ends.
  // While ms < hitstunUntilMs the sim ignores this entity's inputs for
  // attack/dodge purposes (movement still runs via physics).
  hitstunUntilMs: number
  // Absolute ms during which the entity is invulnerable (dodge i-frames).
  // Hit detection skips entities whose ms < invulnUntilMs.
  invulnUntilMs: number
  // Inputs are ignored until the entity first touches the ground after
  // spawn/respawn. 0 means "not yet grounded since (re)spawn" and the
  // tick loop zero-flags this entity's inputs. BH's countdown ends with
  // players falling to the stage; inputs only take effect once they've
  // landed.
  readyForInput: boolean
  // Chase-dodge tokens earned by landing a hit. +2 when airborne lands a
  // hit while grounded, +1 when airborne. Each DodgeDash press consumes
  // one; the counter resets to zero when the attacker throws another
  // attack (chain break) or after CHASE_WINDOW_MS of no dodge.
  chaseDodgeTokens: number
  // Absolute ms at which the chase-dodge token window expires. 0 means
  // no active chase window.
  chaseWindowUntilMs: number
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

// One attack-button press event. `powerId`/`powerName` are the Power record
// the resolver mapped this input to (null if the combination has no damaging
// move, e.g. dodges, or if the lookup failed). Damage and hitbox resolution
// come later; downstream stats consumers can count attempts and, once the
// power is resolved, sum baseDamage as a rough damage-output estimate.
export type AttackAttempt = {
  tick: number
  ms: number
  entityId: number
  button: AttackButton
  direction: AttackDirection
  posture: Posture
  powerId: number | null
  powerName: string | null
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
  // Horizontal acceleration while airborne from MoveLeft/MoveRight input,
  // in units/second^2. Air drift converges on walkSpeed but slower than
  // ground movement.
  airAccel: number
  // Multiplier applied to gravity while Drop is held in the air. BH's
  // fast-fall pulls characters down quicker than gravity alone.
  fastFallMult: number
}
