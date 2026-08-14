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

// One stance loadout (rune) for a legend. Every legend has 10 runes:
// 0=Base, 1-4=Speed/Strength/Weight/Dexterity, 5-8=Super variants, 9=Challenge.
// Each stores ABSOLUTE stat values (not deltas) — this is what the game UI shows
// and what the replay's stanceIndex references. Source: Game.swz.42.xml.
export type Rune = {
  heroName: string
  runeIndex: number
  strength: number
  dexterity: number
  weight: number
  speed: number
  iconName: string
}

export type LevelMeta = {
  levelId: number
  levelName: string
  displayName: string
  devOnly: boolean
  testLevel: boolean
  fileName: string | null
}

// One rung on a legend stat ladder (SpeedN/StrengthN/WeightN/DexterityN from
// Game.swz.52.xml). Every legend references these by index.
export type StatLadder = {
  statName: string
  // Stat ladder field values. Absent fields are omitted (Template / mode
  // variants don't populate every rung).
  values: Record<string, number>
}

// Fully resolved physics numbers for a legend, derived by pairing the legend's
// stat signature (strength/dexterity/weight/speed) with the stat ladders.
export type LegendPhysics = {
  heroId: number
  stats: { strength: number; dexterity: number; weight: number; speed: number }
  physics: {
    // Strength ladder
    impulseMult: number
    // Weight ladder
    recovery: number
    // Speed ladder
    runSpeed: number
    jumpXImpulse: number
    acceleration: number
    friction: number
    airRunSpeed: number
    airAcceleration: number
    airFriction: number
    // Dexterity ladder
    recoverMod: number
    sigRecoverMod: number
    minChargeMod: number
    durabilityMod: number
  }
}

export type Power = {
  powerId: number
  powerName: string
  baseDamage: number
  fixedImpulse: number
  variableImpulse: number
  minimumImpulse: number
  castTime: string
  recoverTime: string
  fixedRecoverTime: string
  fixedStunTime: number
  cooldownTime: number
  onHitCooldownTime: number
  aoeRadiusX: number
  aoeRadiusY: number
  isAirPower: boolean
  isSignature: boolean
  isMultihit: boolean
  isAntiair: boolean
  endOnHit: boolean
  cancelGravity: boolean
  wallCancel: boolean
  hurtboxName: string | null
}

export type Hurtbox = {
  hurtboxName: string
  hurtboxId: number
  animClass: string
  animName: string
  width: number
  height: number
}
