import { router } from '../trpc/trpc'
import { clanRouter } from './clan.router'
import { identityRouter } from './identity.router'
import { leaderboardRouter } from './leaderboard.router'
import { playerRouter } from './player.router'
import { searchRouter } from './search.router'
import { statusRouter } from './status.router'

export const appRouter = router({
  status: statusRouter,
  player: playerRouter,
  clan: clanRouter,
  search: searchRouter,
  leaderboard: leaderboardRouter,
  identity: identityRouter,
})

export type AppRouter = typeof appRouter
