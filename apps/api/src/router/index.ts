import { router } from '../trpc/trpc'
import { accountRouter } from './account.router'
import { clanRouter } from './clan.router'
import { contractProofRouter } from './contract-proof.router'
import { leaderboardRouter } from './leaderboard.router'
import { matchmakingRouter } from './matchmaking.router'
import { playerRouter } from './player.router'
import { searchRouter } from './search.router'
import { statisticsRouter } from './statistics.router'
import { statusRouter } from './status.router'

export const appRouter = router({
  account: accountRouter,
  status: statusRouter,
  contractProof: contractProofRouter,
  player: playerRouter,
  clan: clanRouter,
  search: searchRouter,
  leaderboard: leaderboardRouter,
  statistics: statisticsRouter,
  matchmaking: matchmakingRouter,
})

export type AppRouter = typeof appRouter
