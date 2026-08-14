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
  playerId?: number
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

// One player's input entry inside a STATE_INPUTS section.
//
// The stream layout (verified from real 264/268 replays) is a sequence of
// timestamp-indexed snapshots, one entry per entity. The first i32 is the
// match-relative millisecond the snapshot applies to (input timestamps run
// from ~0 through lengthMs + a small tail, matching the KO timestamps and
// final lengthMs). A per-entity boolean mask of button states follows: each
// set bit is one held input (the low ~10 bits map to the game's Button enum:
// up/down/left/right/light/heavy/throw/dodge/jump/bomb). The format does not
// record "pressed edge" events - a replay tick's action is derived by diffing
// consecutive snapshots' masks.
export type InputSnapshot = {
  /** Match-relative replay timecode, in milliseconds and aligned to 16 ms. */
  timestampMs: number
  /** Raw 14-bit button-state mask for the entity. */
  mask: number
}

export type EntityInputs = {
  /** Entity id these inputs belong to (matches Entity.id). */
  entityId: number
  /** Snapshots in strictly increasing replay-time order. */
  snapshots: InputSnapshot[]
}

export type InputSection = {
  /** Entities that submitted inputs in this match, in stream order. */
  entities: EntityInputs[]
  /** Largest serialized replay timecode, or -1 when the section is empty. */
  maxTimestampMs: number
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
  inputs: InputSection
}
