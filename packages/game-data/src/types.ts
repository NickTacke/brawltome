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

export type Skin = {
  skinId: number
  skinName: string
  legendId: number
  isCrossover: boolean
  displayName: string | null
  imageUrl: string | null
}

export type CatalogDiagnostic = {
  code: 'unknown_legend' | 'unknown_skin' | 'skin_legend_mismatch'
  legendId: number
  skinId: number
}

export type PlayerAppearance = {
  kind: 'legend' | 'crossover'
  legendId: number
  skinId: number
  name: string
  imageUrl: string | null
  fallbackImageUrl: string | null
  diagnostic: CatalogDiagnostic | null
}
