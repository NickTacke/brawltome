import { decodeCursor, encodeCursor, matchDetail, matchHistory } from '@brawltome/matchmaking'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import type { Context } from '../trpc/context'
import { publicProcedure, router } from '../trpc/trpc'

function requireEnabled(ctx: Context) {
  if (!ctx.matchmakingEnabled || !ctx.matchRepo) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'matchmaking disabled' })
  }
  return ctx.matchRepo
}

export const matchmakingRouter = router({
  byId: publicProcedure
    .input(z.object({ slug: z.string().regex(/^[0-9A-Za-z]{9}$/) }))
    .query(async ({ ctx, input }) => {
      const repo = requireEnabled(ctx)
      const res = await matchDetail({ matchRepo: repo }, input.slug)
      if (!res) throw new TRPCError({ code: 'NOT_FOUND' })
      let replayUrl: string | null = null
      if (ctx.r2) {
        try {
          replayUrl = ctx.r2.presignGet(res.match.replayStorageKey, 300)
        } catch {
          replayUrl = null
        }
      }
      return { ...res, replayUrl }
    }),

  byPlayer: publicProcedure
    .input(
      z.object({
        brawlhallaId: z.number().int().positive(),
        cursor: z.string().optional().nullable(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const repo = requireEnabled(ctx)
      const cursor = input.cursor ? decodeCursor(input.cursor) : null
      const res = await matchHistory(
        { matchRepo: repo },
        { brawlhallaId: input.brawlhallaId, cursor, limit: input.limit },
      )
      return {
        matches: res.matches,
        nextCursor: res.nextCursor ? encodeCursor(res.nextCursor) : null,
      }
    }),
})
