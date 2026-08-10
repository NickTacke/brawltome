import { legendMetaInputSchema } from '@brawltome/contracts'
import { mapLegendMetaOutput } from '../mappers/statistics.mapper'
import { publicProcedure, router } from '../trpc/trpc'

export const statisticsRouter = router({
  legendMeta: publicProcedure.input(legendMetaInputSchema).query(async ({ ctx, input }) => {
    return mapLegendMetaOutput(await ctx.statisticsQueries.getLegendMeta(input))
  }),
})
