import { careerWeaponUsageInputSchema, legendMetaInputSchema } from '@brawltome/contracts'
import { mapCareerWeaponUsageOutput } from '../mappers/career-weapon-usage.mapper'
import { mapLegendMetaOutput } from '../mappers/statistics.mapper'
import { publicProcedure, router } from '../trpc/trpc'

export const statisticsRouter = router({
  legendMeta: publicProcedure.input(legendMetaInputSchema).query(async ({ ctx, input }) => {
    return mapLegendMetaOutput(await ctx.statisticsQueries.getLegendMeta(input))
  }),
  careerWeaponUsage: publicProcedure.input(careerWeaponUsageInputSchema).query(async ({ ctx, input }) => {
    return mapCareerWeaponUsageOutput(await ctx.statisticsQueries.getCareerWeaponUsage(input))
  }),
})
