export type WeaponName =
  | 'Hammer'
  | 'Spear'
  | 'Lance'
  | 'Blasters'
  | 'Katars'
  | 'Gauntlets'
  | 'Sword'
  | 'Axe'
  | 'Bow'
  | 'Unarmed'
  | 'Scythe'
  | 'Cannon'
  | 'Orb'
  | 'Greatsword'
  | 'Battleboots'
  | string

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
