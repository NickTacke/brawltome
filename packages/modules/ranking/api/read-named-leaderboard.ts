import { type LeaderboardOutput, parseLeaderboardOutput } from '@brawltome/contracts'
import type { PlayerReferenceQueries } from '@brawltome/player'
import type { RankingQueries } from '../leaderboard'
import { enrichLeaderboardEntries } from './enrich-leaderboard-entries'

/** One page of a board with current player names, so tRPC and oRPC return the same rows. */
export async function readNamedLeaderboard(
  rankingQueries: Pick<RankingQueries, 'getLeaderboard'>,
  references: PlayerReferenceQueries,
  input: Parameters<RankingQueries['getLeaderboard']>[0],
): Promise<LeaderboardOutput> {
  const output = parseLeaderboardOutput(await rankingQueries.getLeaderboard(input))

  if (output.status === 'unavailable') return output

  const entries = await enrichLeaderboardEntries(output.entries, references)

  return parseLeaderboardOutput({ ...output, entries })
}
