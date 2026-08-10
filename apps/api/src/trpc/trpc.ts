import { timingSafeEqual } from 'node:crypto'
import { TRPCError, initTRPC } from '@trpc/server'
import superjson from 'superjson'
import type { Context } from './context'

const t = initTRPC.context<Context>().create({
  transformer: superjson,
})

function secretMatches(provided: string | undefined, expected: string): boolean {
  return Boolean(
    expected &&
      provided &&
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected)),
  )
}

export function createInternalMiddleware(expectedSecret: string) {
  return t.middleware(({ ctx, next }) => {
    const provided = ctx.internalSecret
    if (!secretMatches(provided, expectedSecret)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' })
    }
    return next({ ctx })
  })
}

export function createDiscordInternalMiddleware(expectedSecret: string) {
  return t.middleware(({ ctx, next }) => {
    if (!secretMatches(ctx.discordInternalSecret, expectedSecret)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' })
    }
    return next({ ctx })
  })
}

export function createProtectedMiddleware() {
  return t.middleware(({ ctx, next }) => {
    if (!ctx.account) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required' })
    }
    return next({
      ctx: {
        ...ctx,
        account: ctx.account,
      },
    })
  })
}

const internalSecret = process.env.INTERNAL_API_SECRET ?? ''
const discordInternalSecret = process.env.DISCORD_INTERNAL_API_SECRET ?? ''
const protectedMiddleware = createProtectedMiddleware()

export const router = t.router
export const mergeRouters = t.mergeRouters
export const publicProcedure = t.procedure
export const createInternalProcedure = (expectedSecret: string) =>
  t.procedure.use(createInternalMiddleware(expectedSecret))
export const createDiscordBotProcedure = (expectedInternalSecret: string, expectedDiscordSecret: string) =>
  t.procedure
    .use(createInternalMiddleware(expectedInternalSecret))
    .use(createDiscordInternalMiddleware(expectedDiscordSecret))
export const internalProcedure = createInternalProcedure(internalSecret)
export const discordBotProcedure = createDiscordBotProcedure(internalSecret, discordInternalSecret)
export const protectedProcedure = t.procedure.use(protectedMiddleware)
