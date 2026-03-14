import { router } from '../trpc/trpc'
import { statusRouter } from './status.router'

export const appRouter = router({
  status: statusRouter,
})

export type AppRouter = typeof appRouter
