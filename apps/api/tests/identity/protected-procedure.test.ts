import { describe, expect, it } from 'bun:test'
import { TRPCError, initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { createProtectedMiddleware } from '../../src/trpc/trpc'

interface TestCtx {
  user: { id: string } | null
}

const t = initTRPC.context<TestCtx>().create({ transformer: superjson })
const middleware = createProtectedMiddleware()
const procedure = t.procedure.use(middleware)
const router = t.router({ test: procedure.query(({ ctx }) => ctx.user.id) })
const caller = t.createCallerFactory(router)

describe('protectedProcedure', () => {
  it('allows requests with a user', async () => {
    const result = await caller({ user: { id: 'u1' } }).test()
    expect(result).toBe('u1')
  })

  it('rejects anonymous requests with UNAUTHORIZED', async () => {
    try {
      await caller({ user: null }).test()
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError)
      expect((e as TRPCError).code).toBe('UNAUTHORIZED')
    }
  })
})
