import type { Database } from '@brawltome/foundation'
import {
  createPostgresCareerPlayers,
  createPostgresPlayerReferences,
  createPostgresRankedPlayers,
} from '@brawltome/player'

// the trust rule looks for the event legends among this many of the account's most played legends
const topLegendCount = 8

export type AccountSignals = { names: string[]; topLegends: string[]; region: string | null }

type CareerLegend = { legendNameKey: string; games: number }

function mostPlayed(legends: CareerLegend[]): string[] {
  const byGames = [...legends].sort((left, right) => right.games - left.games)

  return byGames.slice(0, topLegendCount).map((legend) => legend.legendNameKey)
}

/** What the player module knows of an account, for checking that an esports record belongs to it. */
export async function readAccountSignals(database: Database, brawlhallaId: number): Promise<AccountSignals> {
  const [reference, career, ranked] = await Promise.all([
    createPostgresPlayerReferences(database).byId(brawlhallaId),
    createPostgresCareerPlayers(database).byId(brawlhallaId),
    createPostgresRankedPlayers(database).byId(brawlhallaId),
  ])

  const names = reference ? [reference.name, ...reference.aliases] : []
  const topLegends = mostPlayed(career?.snapshot?.legends ?? [])
  // ranked keeps an empty region for a player with no 1v1 region
  const rankedRegion = ranked?.snapshot?.oneVsOne.region ?? ''
  const region = rankedRegion === '' ? null : rankedRegion

  return { names, topLegends, region }
}
