import { z } from 'zod'
import { getPlayer } from '../services/player.service'
import { publicProcedure, router } from '../trpc/trpc'

export const playerRouter = router({
  byId: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    return getPlayer(ctx, input.id)
  }),
})
