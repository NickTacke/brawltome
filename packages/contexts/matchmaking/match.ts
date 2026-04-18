export type MatchSlug = string

export type MatchRow = {
  slug: MatchSlug
  dedupeHash: string | null
  uploadedBy: string
  uploadedAt: Date
  parseStatus: 'parsed' | 'pending'
  formatVersion: number | null
  replayStorageKey: string
  replayBytes: number
  gamePatch: string | null
  randomSeed: number | null
  playlistId: number | null
  playlistName: string | null
  onlineGame: number | null
  levelId: number | null
  durationMs: number | null
  matchDurationMs: number | null
  endOfMatchFanfareId: number | null
  winnerTeam: number | null
  scoringTypeId: number | null
  detailedStatsKey: string | null
  simVersion: number | null
  simRanAt: Date | null
}

export type MatchPlayerRow = {
  id: number
  matchSlug: MatchSlug
  replayEntityId: number
  brawlhallaId: number | null
  linkSource: 'overlay_memory' | null
  displayName: string
  team: number
  legendId: number | null
  costumeId: number | null
  stanceIndex: number | null
  weaponSkin1: number | null
  weaponSkin2: number | null
  colorSchemeId: number | null
  companionId: number | null
  emitterId: number | null
  trailEffectId: number | null
  avatarId: number | null
  isBot: number | null
  finalScore: number | null
}

export type MatchEventRow = {
  id: number
  matchSlug: MatchSlug
  entityId: number
  timestampMs: number
  kind: 'ko' | 'self_destruct' | 'victory_face'
}
