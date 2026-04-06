import { publicProcedure, router } from '../trpc/trpc'

export const identityRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return null
    const { primaryAccount } = ctx.user
    const avatarUrl = primaryAccount.avatarHash
      ? `https://cdn.discordapp.com/avatars/${primaryAccount.providerAccountId}/${primaryAccount.avatarHash}.png`
      : null
    return {
      id: ctx.user.id,
      username: primaryAccount.username,
      avatarUrl,
      createdAt: ctx.user.createdAt,
    }
  }),
})
