import {
  type LeaderboardRecentActivityOutput,
  type LeaderboardRecentMoversOutput,
  leaderboardRecentMoversOutputSchema,
  parseLeaderboardRecentActivityOutput,
} from '@brawltome/contracts'
import type { PlayerReferenceQueries } from '@brawltome/player'
import type { RankingQueries, RecentMoversQueries } from '../leaderboard'
import { enrichLeaderboardEntries } from './enrich-leaderboard-entries'

/** One page of the last hour's activity with current player names, so tRPC and oRPC return the same rows. */
export async function readNamedRecentActivity(
  rankingQueries: Pick<RankingQueries, 'getRecentActivity'>,
  references: PlayerReferenceQueries,
  input: Parameters<RankingQueries['getRecentActivity']>[0],
): Promise<LeaderboardRecentActivityOutput> {
  const output = parseLeaderboardRecentActivityOutput(await rankingQueries.getRecentActivity(input))

  if (output.status === 'unavailable') return output

  const entries = await enrichLeaderboardEntries(output.entries, references)

  return parseLeaderboardRecentActivityOutput({ ...output, entries })
}

/** The last hour's biggest climbers, drops and most games, with current player names. */
export async function readNamedRecentMovers(
  moversQueries: RecentMoversQueries,
  references: PlayerReferenceQueries,
  input: Parameters<RecentMoversQueries['getRecentMovers']>[0],
): Promise<LeaderboardRecentMoversOutput> {
  const output = leaderboardRecentMoversOutputSchema.parse(await moversQueries.getRecentMovers(input))

  if (output.status === 'unavailable') return output

  const [climbers, drops, mostGames] = await Promise.all([
    enrichLeaderboardEntries(output.climbers, references),
    enrichLeaderboardEntries(output.drops, references),
    enrichLeaderboardEntries(output.mostGames, references),
  ])

  return leaderboardRecentMoversOutputSchema.parse({ ...output, climbers, drops, mostGames })
}
