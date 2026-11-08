export type ClanProvenance = {
  source: 'v1-guild-stats' | 'v1-guild-members' | 'legacy-import'
  outcome: 'success' | 'ambiguous-failure' | 'admission-limited' | 'source-rate-limited' | 'legacy-unknown'
  legacyTimestamp?: string
  sourceTable?: 'clan'
  sourceKey?: string
  archiveChecksum?: string
  sourceTables?: Array<'clan_member' | 'player_clan'>
  archiveChecksums?: string[]
}
