import { InvalidPinnedPlayerError } from '@brawltome/accounts'
import {
  accountPreferencesSchema,
  accountViewSchema,
  pinnedPlayerInputSchema,
  pinnedPlayerOrderInputSchema,
  pinnedPlayersSchema,
  playerShortcutsSchema,
  primaryPlayerVerificationStateSchema,
} from '@brawltome/contracts'
import { TRPCError } from '@trpc/server'
import {
  type AccountPlayerFacts,
  toAccountPreferences,
  toAccountView,
  toPinnedPlayers,
  toPlayerShortcuts,
  toPrimaryPlayerVerificationState,
} from '../mappers/account.mapper'
import { mapPlayerRankedProfile } from '../mappers/player-ranked.mapper'
import type { Context } from '../trpc/context'
import { protectedProcedure, publicProcedure, router } from '../trpc/trpc'

async function readPlayerFacts(ctx: Context, brawlhallaIds: readonly number[]) {
  const facts = new Map<number, AccountPlayerFacts>()
  for (let index = 0; index < brawlhallaIds.length; index += 5) {
    const entries = await Promise.all(
      brawlhallaIds.slice(index, index + 5).map(async (brawlhallaId) => {
        const [player, currentSeason] = await Promise.all([
          ctx.playerReferenceQueries.byId(brawlhallaId),
          ctx.rankedPlayerQueries.byId(brawlhallaId),
        ])
        return [brawlhallaId, { player, currentSeason: mapPlayerRankedProfile(currentSeason) }] as const
      }),
    )
    for (const [brawlhallaId, profileFacts] of entries) facts.set(brawlhallaId, profileFacts)
  }
  return facts
}

async function readPinnedPlayers(ctx: Context, accountId: string) {
  const pinnedPlayers = await ctx.accounts.getPinnedPlayers(accountId)
  const facts = await readPlayerFacts(
    ctx,
    pinnedPlayers.map(({ brawlhallaId }) => brawlhallaId),
  )
  return toPinnedPlayers(pinnedPlayers, facts)
}

async function readPlayerShortcuts(ctx: Context, accountId: string) {
  const shortcuts = await ctx.accounts.getPlayerShortcuts(accountId)
  const brawlhallaIds = [
    ...(shortcuts.primaryPlayer ? [shortcuts.primaryPlayer.brawlhallaId] : []),
    ...shortcuts.pinnedPlayers.map(({ brawlhallaId }) => brawlhallaId),
  ]
  return toPlayerShortcuts(shortcuts, await readPlayerFacts(ctx, brawlhallaIds))
}

function pinnedPlayerInputError(error: unknown): never {
  if (error instanceof InvalidPinnedPlayerError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
  }
  throw error
}

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
  primaryPlayer: protectedProcedure
    .output(primaryPlayerVerificationStateSchema)
    .query(async ({ ctx }) =>
      toPrimaryPlayerVerificationState(await ctx.accounts.getPrimaryPlayerVerificationState(ctx.account.id)),
    ),
  playerShortcuts: protectedProcedure
    .output(playerShortcutsSchema)
    .query(({ ctx }) => readPlayerShortcuts(ctx, ctx.account.id)),
  pinnedPlayers: protectedProcedure
    .output(pinnedPlayersSchema)
    .query(({ ctx }) => readPinnedPlayers(ctx, ctx.account.id)),
  pinPlayer: protectedProcedure
    .input(pinnedPlayerInputSchema)
    .output(pinnedPlayersSchema)
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.playerReferenceQueries.byId(input.brawlhallaId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Player not found' })
      }
      try {
        await ctx.accounts.pinPlayer(ctx.account.id, input.brawlhallaId)
      } catch (error) {
        pinnedPlayerInputError(error)
      }
      return readPinnedPlayers(ctx, ctx.account.id)
    }),
  unpinPlayer: protectedProcedure
    .input(pinnedPlayerInputSchema)
    .output(pinnedPlayersSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.accounts.unpinPlayer(ctx.account.id, input.brawlhallaId)
      return readPinnedPlayers(ctx, ctx.account.id)
    }),
  reorderPinnedPlayers: protectedProcedure
    .input(pinnedPlayerOrderInputSchema)
    .output(pinnedPlayersSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.accounts.reorderPinnedPlayers(ctx.account.id, input.brawlhallaIds)
      } catch (error) {
        pinnedPlayerInputError(error)
      }
      return readPinnedPlayers(ctx, ctx.account.id)
    }),
})
