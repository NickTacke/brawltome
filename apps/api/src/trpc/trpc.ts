import { timingSafeEqual } from 'node:crypto'
import { TRPCError, initTRPC } from '@trpc/server'
import superjson from 'superjson'
import type { Context } from './context'

const t = initTRPC.context<Context>().create({
  transformer: superjson,
})

export function createInternalMiddleware(expectedSecret: string) {
  return t.middleware(({ ctx, next }) => {
    if (!expectedSecret) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' })
    }
    const provided = ctx.internalSecret
    if (
      !provided ||
      provided.length !== expectedSecret.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expectedSecret))
    ) {
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
const protectedMiddleware = createProtectedMiddleware()

export const router = t.router
export const mergeRouters = t.mergeRouters
export const publicProcedure = t.procedure
export const createInternalProcedure = (expectedSecret: string) =>
  t.procedure.use(createInternalMiddleware(expectedSecret))
export const internalProcedure = createInternalProcedure(internalSecret)
export const protectedProcedure = t.procedure.use(protectedMiddleware)
