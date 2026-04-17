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
}
