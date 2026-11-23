import type { RawMatch, RawOpponent, RawPr } from '../source/raw-types'
import { eventHeading, isSideModeEvent } from './event-names'
import { resultLabels } from './result-labels'
import type { StoredEsports, StoredPlacement } from './stored-esports'

export type EsportsMode = '1v1' | '2v2'

export type PowerRanking = {
  mode: EsportsMode
  rank: number
  region: string
  gold: number
  silver: number
  bronze: number
  top8: number
}

export type EsportsSet = {
  id: string
  isWin: boolean
  // won or lost without playing, brawltools scores the side that didn't show as -1
  isForfeit: boolean
  score: string
  opponents: RawOpponent[]
  legendKey: string | null
  opponentLegendKey: string | null
}

export type SetRecord = { wins: number; losses: number }

export type EsportsResult = {
  id: string
  mode: EsportsMode
  placement: number
  fullName: string
  heading: string
  // a short name for a tile and the line under it, no two results of one player share both
  title: string
  meta: string
  // unix seconds
  startTime: number
  isOfficial: boolean
  isOnline: boolean
  legendKey: string | null
  // first round first
  sets: EsportsSet[]
  // forfeits left out; null when no set was played
  setRecord: SetRecord | null
}

export type EsportsProfile = {
  // null when the player has not earned anything
  earnings: number | null
  rankings: PowerRanking[]
  results: EsportsResult[]
}

type UnlabelledResult = Omit<EsportsResult, 'title' | 'meta'>

const dayMs = 86_400_000

function toRanking(mode: EsportsMode, raw: RawPr | null): PowerRanking | null {
  if (!raw || raw.pr.powerRanking <= 0) return null

  const { powerRanking, region, gold, silver, bronze, top8 } = raw.pr

  return { mode, rank: powerRanking, region, gold, silver, bronze, top8 }
}

// brawltools sends legend names in capitals, the site's art is keyed by the lowercase name; a random pick or a name
// the site has no art for counts as unknown, so it never shows a placeholder
function mostPlayed(legends: string[], legendKeys: ReadonlySet<string>): string | null {
  const counts = new Map<string, number>()

  for (const legend of legends) {
    const key = legend.toLowerCase()

    if (legendKeys.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const [top] = [...counts].sort((left, right) => right[1] - left[1])

  return top ? top[0] : null
}

function toSet(match: RawMatch, legendKeys: ReadonlySet<string>): EsportsSet {
  const [own, theirs] = match.scores

  const isForfeit = own < 0 || theirs < 0

  return {
    id: match.matchId,
    isWin: own > theirs,
    isForfeit,
    score: isForfeit ? 'DQ' : `${own}-${theirs}`,
    opponents: match.opponent,
    legendKey: mostPlayed(match.legends[0] ?? [], legendKeys),
    opponentLegendKey: mostPlayed(match.legends[1] ?? [], legendKeys),
  }
}

// a set where neither side showed has no result to show
const isPlayedOrForfeited = (match: RawMatch) => match.scores.some((score) => score >= 0)

// sets come latest first for most events; where every set has a start time, that time decides the order instead
function inRunOrder(matches: RawMatch[]): RawMatch[] {
  const isTimed = matches.every((match) => typeof match.startTime === 'number')

  if (!isTimed) return [...matches].reverse()

  return [...matches].sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0))
}

// the record counts the sets that were played, a forfeit says nothing about how the player did
function toSetRecord(sets: EsportsSet[]): SetRecord | null {
  const played = sets.filter((set) => !set.isForfeit)

  if (played.length === 0) return null

  const wins = played.filter((set) => set.isWin).length

  return { wins, losses: played.length - wins }
}

function toResult(stored: StoredPlacement, matches: RawMatch[], legendKeys: ReadonlySet<string>): UnlabelledResult {
  const mode: EsportsMode = stored.mode === 1 ? '1v1' : '2v2'
  const sets = inRunOrder(matches.filter(isPlayedOrForfeited)).map((match) => toSet(match, legendKeys))
  const startTime = Math.floor(stored.startTime.getTime() / 1000)

  return {
    id: `${mode}-${stored.tournamentId}`,
    mode,
    placement: stored.placement,
    fullName: stored.tournamentName,
    heading: eventHeading(stored.tournamentName, stored.isOfficial, startTime),
    startTime,
    isOfficial: stored.isOfficial,
    isOnline: stored.isOnline,
    legendKey: mostPlayed(
      sets.map((set) => set.legendKey ?? ''),
      legendKeys,
    ),
    sets,
    setRecord: toSetRecord(sets),
  }
}

// an event split into pools comes back once per pool, same name and day; the best finish stands for it
function withoutPoolRepeats(results: UnlabelledResult[]): UnlabelledResult[] {
  const best = new Map<string, UnlabelledResult>()

  for (const result of results) {
    const key = `${result.mode}|${result.fullName}|${Math.floor((result.startTime * 1000) / dayMs)}`
    const kept = best.get(key)

    if (!kept || result.placement < kept.placement) best.set(key, result)
  }

  return [...best.values()]
}

function withLabels(results: UnlabelledResult[]): EsportsResult[] {
  const labels = resultLabels(results)

  return results.map((result) => ({ ...result, ...(labels.get(result.id) as { title: string; meta: string }) }))
}

// null when the player has no placement to show: a power ranking or earnings alone make no section
export function shapeEsportsProfile(stored: StoredEsports, legendKeys: ReadonlySet<string>): EsportsProfile | null {
  const results = stored.placements
    .filter(({ tournamentName }) => !isSideModeEvent(tournamentName))
    .map((placement) => toResult(placement, stored.setsByTournament.get(placement.tournamentId) ?? [], legendKeys))

  const newestFirst = withoutPoolRepeats(results).sort((left, right) => right.startTime - left.startTime)

  if (newestFirst.length === 0) return null

  const rankings = [toRanking('1v1', stored.pr1v1), toRanking('2v2', stored.pr2v2)].filter(
    (ranking): ranking is PowerRanking => ranking !== null,
  )

  // earnings are the player's total, both modes answer with the same figure
  const earnings = Math.max(stored.pr1v1?.earnings ?? 0, stored.pr2v2?.earnings ?? 0)

  return { earnings: earnings > 0 ? earnings : null, rankings, results: withLabels(newestFirst) }
}
