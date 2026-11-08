import type { ClanRefreshSection } from './refresh-section'
import type { SourceFailure } from './source-failure'

// where a stored section came from; the legacy fields point at the v2 rows it was imported from
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

const sectionSources = {
  profile: 'v1-guild-stats',
  roster: 'v1-guild-members',
} as const satisfies Record<ClanRefreshSection, ClanProvenance['source']>

export function successProvenance(section: ClanRefreshSection): ClanProvenance {
  return { source: sectionSources[section], outcome: 'success' }
}

export function failedCheckProvenance(section: ClanRefreshSection, failure: SourceFailure): ClanProvenance {
  return { source: sectionSources[section], outcome: failure.outcome }
}
