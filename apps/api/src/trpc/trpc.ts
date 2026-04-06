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
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required' })
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    })
  })
}

const internalSecret = process.env.INTERNAL_API_SECRET ?? ''
const internalMiddleware = createInternalMiddleware(internalSecret)
const protectedMiddleware = createProtectedMiddleware()

export const router = t.router
export const publicProcedure = t.procedure
export const internalProcedure = t.procedure.use(internalMiddleware)
export const protectedProcedure = t.procedure.use(protectedMiddleware)
