export { isSideModeEvent } from './event-names'
export { type EsportsFreshness, esportsFreshness, type RefreshState } from './freshness'
export { highlightTournamentIds, pickHighlights } from './highlights'
export { buildLegendLookup, type LegendLookup, resolveLegendKey } from './legend-keys'
export type {
  EsportsMode,
  EsportsOpponent,
  EsportsProfile,
  EsportsResult,
  EsportsSet,
  PowerRanking,
  SetRecord,
} from './profile'
export { shapeEsportsProfile } from './profile'
export { failureBackoffMs, linkedTtlMs, noneTtlMs } from './refresh-timing'
export type { StoredEsports, StoredPlacement } from './stored-esports'
export { isTrustedLink, type LinkEvidence } from './trust'
