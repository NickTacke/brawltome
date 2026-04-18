// Weapon identifier. Kept as bare string rather than a literal union because
// BMG owns the canonical list and we'd drift from it. Compare against
// constants from game files, not hardcoded strings.
export type WeaponName = string

export type Legend = {
  heroId: number
  heroName: string
  displayName: string
  strength: number
  dexterity: number
  weight: number
  speed: number
  weaponOne: WeaponName
  weaponTwo: WeaponName
  isActive: boolean
  isBeta: boolean
}

export type LevelMeta = {
  levelId: number
  levelName: string
  displayName: string
  devOnly: boolean
  testLevel: boolean
  fileName: string | null
}

export type Power = {
  powerId: number
  powerName: string
  // Arrays indexed by hitbox slot. A single-hit move has one element; a
  // multi-hit move has one per hitbox referenced by castTime. The CSV
  // source stores these as comma-joined strings like "20,20,0". Elements
  // can legitimately be 0 to disable that slot's hit.
  baseDamage: number[]
  fixedImpulse: number[]
  variableImpulse: number[]
  minimumImpulse: number[]
  castTime: string
  recoverTime: string
  fixedRecoverTime: string
  fixedStunTime: number
  cooldownTime: number
  onHitCooldownTime: number
  // Per-hitbox-slot dimensions and offsets of the attack's AABB. Indexed
  // by the hitbox slot referenced by castTime phases. X offsets are in
  // attacker-facing orientation (multiply by `facing` before applying to
  // world x). Empty arrays for powers without explicit hitboxes.
  aoeRadiusX: number[]
  aoeRadiusY: number[]
  centerOffsetX: number[]
  centerOffsetY: number[]
  isAirPower: boolean
  isSignature: boolean
  isMultihit: boolean
  isAntiair: boolean
  endOnHit: boolean
  cancelGravity: boolean
  wallCancel: boolean
  hurtboxName: string | null
}

// A per-animation hurtbox record. Width/Height/OffsetX/OffsetY are
// per-animation-frame arrays whose i-th entry covers the i-th span in
// `frames` (e.g. frames="1,2-3,4" means entry 0 covers frame 1, entry 1
// covers frames 2 and 3, entry 2 covers frame 4). Offsets are in the
// attacker-facing orientation (positive X faces right); callers multiply
// by `facing` before applying to the entity's world position.
export type Hurtbox = {
  hurtboxName: string
  hurtboxId: number
  animClass: string
  animName: string
  width: number[]
  height: number[]
  offsetX: number[]
  offsetY: number[]
  frames: string
}

// A flat collision segment. Either horizontal (X1/X2 + Y) or vertical (X + Y1/Y2).
// Coordinates are in level space (same units as Platform X/Y).
export type CollisionLine = {
  kind: 'hard' | 'soft' | 'no_slide' | 'bouncy_hard' | 'bouncy_no_slide'
  x1: number
  y1: number
  x2: number
  y2: number
}

// Where weapons and other items can spawn on a level. Brawlhalla has three
// flavours: `init` lays an item at match start (a single slot), `teamInit`
// is a per-team initial slot (rarity-unclear; assigned in XML order), and
// `rolling` is an area that cycles items through a respawn timer over the
// course of the match. Area dimensions `w`/`h` default to 0 for the init
// variants since they're point spawns.
export type ItemSpawn = {
  kind: 'init' | 'teamInit' | 'rolling'
  x: number
  y: number
  w: number
  h: number
}

// Level geometry the simulator needs: blast-zone boundaries, collision segments, respawns.
// One record per LevelDesc file; keyed by levelName on the generated map.
export type LevelGeometry = {
  levelName: string
  assetDir: string
  cameraBounds: { x: number; y: number; w: number; h: number } | null
  spawnBotBounds: { x: number; y: number; w: number; h: number } | null
  killBounds: { left: number | null; right: number | null; top: number | null; bottom: number | null }
  respawns: { x: number; y: number }[]
  itemSpawns: ItemSpawn[]
  collisions: CollisionLine[]
}
