import { router } from '../trpc/trpc'
import { clanRouter } from './clan.router'
import { contractProofRouter } from './contract-proof.router'
import { identityRouter } from './identity.router'
import { leaderboardRouter } from './leaderboard.router'
import { matchmakingRouter } from './matchmaking.router'
import { playerRouter } from './player.router'
import { searchRouter } from './search.router'
import { statusRouter } from './status.router'

export const appRouter = router({
  status: statusRouter,
  contractProof: contractProofRouter,
  player: playerRouter,
  clan: clanRouter,
  search: searchRouter,
  leaderboard: leaderboardRouter,
  identity: identityRouter,
  matchmaking: matchmakingRouter,
})

export type AppRouter = typeof appRouter
