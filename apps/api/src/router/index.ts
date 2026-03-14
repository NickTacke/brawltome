import { router } from '../trpc/trpc'
import { playerRouter } from './player.router'
import { statusRouter } from './status.router'

export const appRouter = router({
  status: statusRouter,
  player: playerRouter,
})

export type AppRouter = typeof appRouter
