import { unlinkPlayer } from '@brawltome/identity'
import { protectedProcedure, publicProcedure, router } from '../trpc/trpc'

export const identityRouter = router({
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.account) return null

    const link = await ctx.playerLinkRepo.findByUserId(ctx.account.id)

    return {
      id: ctx.account.id,
      username: ctx.account.displayName,
      avatarUrl: ctx.account.avatarUrl,
      createdAt: ctx.account.createdAt,
      playerLink: link
        ? {
            brawlhallaId: link.brawlhallaId,
            steamId: link.steamId,
            status: link.status,
            linkedAt: link.linkedAt,
          }
        : null,
    }
  }),

  unlinkPlayer: protectedProcedure.mutation(async ({ ctx }) => {
    await unlinkPlayer({ playerLinkRepo: ctx.playerLinkRepo }, ctx.account.id)
    return { success: true }
  }),
})
