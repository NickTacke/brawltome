import { careerWeaponUsageInputSchema, legendMetaInputSchema } from '@brawltome/contracts'
import { mapCareerWeaponUsageHistoryOutput, mapCareerWeaponUsageOutput } from '../mappers/career-weapon-usage.mapper'
import { mapLegendMetaHistoryOutput, mapLegendMetaOutput } from '../mappers/statistics.mapper'
import { publicProcedure, router } from '../trpc/trpc'

export const statisticsRouter = router({
  legendMeta: publicProcedure.input(legendMetaInputSchema).query(async ({ ctx, input }) => {
    return mapLegendMetaOutput(await ctx.statisticsQueries.getLegendMeta(input))
  }),
  legendMetaHistory: publicProcedure.input(legendMetaInputSchema).query(async ({ ctx, input }) => {
    return mapLegendMetaHistoryOutput(await ctx.statisticsQueries.getLegendMetaHistory(input))
  }),
  careerWeaponUsage: publicProcedure.input(careerWeaponUsageInputSchema).query(async ({ ctx, input }) => {
    return mapCareerWeaponUsageOutput(await ctx.statisticsQueries.getCareerWeaponUsage(input))
  }),
  careerWeaponUsageHistory: publicProcedure.input(careerWeaponUsageInputSchema).query(async ({ ctx, input }) => {
    return mapCareerWeaponUsageHistoryOutput(await ctx.statisticsQueries.getCareerWeaponUsageHistory(input))
  }),
})
