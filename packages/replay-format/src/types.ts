export type Hero = {
  heroId: number
  costumeId: number
  stanceIndex: number
  weaponSkin1: number
  weaponSkin2: number
  morphWeapon2: boolean
}

export type PlayerData = {
  colorSchemeId: number
  spawnBotId: number
  companionId: number
  emitterId: number
  trailEffectId: number
  playerThemeId: number
  taunts: number[]
  winTauntId: number
  loseTauntId: number
  avatarId: number
  connectionTime: number
  heroes: Hero[]
}

export type Entity = {
  id: number
  name: string
  team: number
  isBot: boolean
  playerData: PlayerData
}

export type GameSettings = {
  flags: number
  maxPlayers: number
  duration: number
  roundDuration: number
  startingLives: number
  scoringTypeId: number
  scoreToWin: number
  gameSpeed: number
  damageMultiplier: number
  levelSetId: number
  itemSpawnRuleSetId: number
  weaponSpawnRateId: number
  gadgetSpawnRateId: number
  customGadgetSelection: number
  variation: number
}

export type KoEvent = {
  entityId: number
  timestampMs: number
}

export type MatchResult = {
  lengthMs: number
  scores: Record<number, number>
  endOfMatchFanfareId: number
}

// One input frame. inputFlags is a 14-bit bitmask (see InputFlag below).
export type InputEvent = {
  timestampMs: number
  inputFlags: number
}

// Ordered inputs for a single entity over the whole match.
export type EntityInputs = {
  entityId: number
  inputs: InputEvent[]
}

// 14-bit input flag set used by Brawlhalla replays, ordered by bit position.
export const InputFlag = {
  AimUp: 1 << 0,
  Drop: 1 << 1,
  MoveLeft: 1 << 2,
  MoveRight: 1 << 3,
  Jump: 1 << 4,
  PrioritiseNeutral: 1 << 5,
  Heavy: 1 << 6,
  Light: 1 << 7,
  DodgeDash: 1 << 8,
  PickUpThrow: 1 << 9,
  TauntUp: 1 << 10,
  TauntRight: 1 << 11,
  TauntDown: 1 << 12,
  TauntLeft: 1 << 13,
} as const

export type ParsedReplay = {
  formatVersion: number
  randomSeed: number
  playlistId: number
  playlistName: string | null
  onlineGame: boolean
  gameSettings: GameSettings
  levelId: number
  heroCount: number
  entities: Entity[]
  results: MatchResult[]
  koFaces: KoEvent[]
  victoryFaces: KoEvent[] | null
  gameDataChecksum: number
  // Empty when the replay was parsed with `inputs: false` (default). Set
  // explicitly via parse(raw, { inputs: true }); simulator code wants it,
  // everything else can skip the memory cost.
  inputs: EntityInputs[]
}
