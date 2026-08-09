import { describe, expect, it } from 'bun:test'
import { TRPCError, initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { createProtectedMiddleware } from '../../src/trpc/trpc'

interface TestCtx {
  account: { id: string } | null
}

const t = initTRPC.context<TestCtx>().create({ transformer: superjson })
const middleware = createProtectedMiddleware()
const procedure = t.procedure.use(middleware)
const router = t.router({ test: procedure.query(({ ctx }) => ctx.account.id) })
const caller = t.createCallerFactory(router)

describe('protectedProcedure', () => {
  it('allows requests with an authenticated account', async () => {
    const result = await caller({ account: { id: 'u1' } }).test()
    expect(result).toBe('u1')
  })

  it('rejects anonymous requests with UNAUTHORIZED', async () => {
    try {
      await caller({ account: null }).test()
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError)
      expect((error as TRPCError).code).toBe('UNAUTHORIZED')
    }
  })
})
