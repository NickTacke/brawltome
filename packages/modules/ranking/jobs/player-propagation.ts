import type { Telemetry } from '@brawltome/telemetry'
import type { LeaderboardGenerationCandidate, RankingPublicationStore } from '../leaderboard'
import { recordLeaderboardTelemetry } from './leaderboard-telemetry'

export type LeaderboardPlayerStanding = {
  brawlhallaId: number
  region: string
  rating: number
  peakRating: number
  tier: string | null
  wins: number
  games: number
}

export type LeaderboardPlayerNames = {
  applyLeaderboardNames(input: {
    observedAt: Date
    players: Array<{ brawlhallaId: number; name: string }>
  }): Promise<{ changed: number }>
}

export type LeaderboardRankedStandings = {
  applyLeaderboardRanked(input: {
    observedAt: Date
    players: LeaderboardPlayerStanding[]
  }): Promise<{ changed: number }>
}

export type PlayerPropagationDependencies = {
  playerNames: LeaderboardPlayerNames
  rankedStandings: LeaderboardRankedStandings
  telemetry: Telemetry
}

function snapshotRows(candidate: LeaderboardGenerationCandidate) {
  return [...candidate.snapshots.values()].flat()
}

function contestants(candidate: LeaderboardGenerationCandidate) {
  const namesById = new Map<number, string>()

  for (const { identity } of snapshotRows(candidate)) {
    const players = identity.type === 'fixed-two-vs-two-team' ? identity.players : [identity.player]

    for (const player of players) {
      if (!namesById.has(player.brawlhallaId)) namesById.set(player.brawlhallaId, player.name)
    }
  }

  return [...namesById].map(([brawlhallaId, name]) => ({ brawlhallaId, name }))
}

function oneVsOneStandings(candidate: LeaderboardGenerationCandidate): LeaderboardPlayerStanding[] {
  const standings = new Map<number, LeaderboardPlayerStanding>()

  for (const row of snapshotRows(candidate)) {
    if (row.identity.type !== 'one-vs-one-player') continue

    const { brawlhallaId } = row.identity.player

    if (standings.has(brawlhallaId)) continue

    standings.set(brawlhallaId, {
      brawlhallaId,
      region: row.region,
      rating: row.rating,
      peakRating: row.peakRating,
      tier: row.tier,
      wins: row.wins,
      games: row.wins + row.losses,
    })
  }

  return [...standings.values()]
}

async function propagateNames(
  dependencies: PlayerPropagationDependencies,
  candidate: LeaderboardGenerationCandidate,
): Promise<void> {
  const { playerNames, telemetry } = dependencies

  try {
    const { changed } = await playerNames.applyLeaderboardNames({
      observedAt: candidate.observedAt,
      players: contestants(candidate),
    })

    recordLeaderboardTelemetry(telemetry, (active) =>
      active.logger.info('leaderboard.player_names.applied', { mode: candidate.mode, changed }),
    )
  } catch (error) {
    recordLeaderboardTelemetry(telemetry, (active) =>
      active.logger.error('leaderboard.player_names.failed', error, { mode: candidate.mode }),
    )
  }
}

async function propagateStandings(
  dependencies: PlayerPropagationDependencies,
  candidate: LeaderboardGenerationCandidate,
): Promise<void> {
  const { rankedStandings, telemetry } = dependencies

  try {
    const { changed } = await rankedStandings.applyLeaderboardRanked({
      observedAt: candidate.observedAt,
      players: oneVsOneStandings(candidate),
    })

    recordLeaderboardTelemetry(telemetry, (active) =>
      active.logger.info('leaderboard.player_ranked.applied', { mode: candidate.mode, changed }),
    )
  } catch (error) {
    recordLeaderboardTelemetry(telemetry, (active) =>
      active.logger.error('leaderboard.player_ranked.failed', error, { mode: candidate.mode }),
    )
  }
}

// leaderboards observe current names and 1v1 standings for thousands of players nobody visits; feed them to Players
// after the generation is durable, a failure only delays them until the next scan so it never fails the publication
export function withPlayerPropagation(
  publication: RankingPublicationStore,
  dependencies: PlayerPropagationDependencies,
): RankingPublicationStore {
  return {
    recordCollectionFailure: (authorization, failure) => publication.recordCollectionFailure(authorization, failure),
    async publishGeneration(authorization, candidate) {
      const result = await publication.publishGeneration(authorization, candidate)

      if (result !== 'published' && result !== 'already-published') return result

      await propagateNames(dependencies, candidate)

      if (candidate.mode === '1v1') await propagateStandings(dependencies, candidate)

      return result
    },
  }
}
