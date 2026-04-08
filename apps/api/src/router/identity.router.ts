import { unlinkPlayer } from '@brawltome/identity'
import { protectedProcedure, publicProcedure, router } from '../trpc/trpc'

export const identityRouter = router({
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null
    const { primaryAccount } = ctx.user
    const avatarUrl = primaryAccount.avatarHash
      ? `https://cdn.discordapp.com/avatars/${primaryAccount.providerAccountId}/${primaryAccount.avatarHash}.png`
      : null

    const link = await ctx.playerLinkRepo.findByUserId(ctx.user.id)

    return {
      id: ctx.user.id,
      username: primaryAccount.username,
      avatarUrl,
      createdAt: ctx.user.createdAt,
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
    await unlinkPlayer({ playerLinkRepo: ctx.playerLinkRepo }, ctx.user.id)
    return { success: true }
  }),
})
