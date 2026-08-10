import { accountPreferencesSchema, accountViewSchema } from '@brawltome/contracts'
import { toAccountPreferences, toAccountView } from '../mappers/account.mapper'
import { protectedProcedure, publicProcedure, router } from '../trpc/trpc'

export const accountRouter = router({
  current: publicProcedure.output(accountViewSchema).query(({ ctx }) => toAccountView(ctx.account)),
  preferences: publicProcedure.output(accountPreferencesSchema).query(async ({ ctx }) => {
    const preferences = await ctx.accounts.getPreferences(ctx.account?.id ?? null)
    return toAccountPreferences(preferences)
  }),
  updatePreferences: protectedProcedure
    .input(accountPreferencesSchema)
    .output(accountPreferencesSchema)
    .mutation(async ({ ctx, input }) => {
      const preferences = await ctx.accounts.updatePreferences(ctx.account.id, input)
      return toAccountPreferences(preferences)
    }),
})
