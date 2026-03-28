import { describe, expect, it } from 'bun:test'
import { TRPCError, initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { createInternalMiddleware } from '../src/trpc/trpc'

describe('internalProcedure', () => {
  const t = initTRPC.context<{ internalSecret: string | undefined }>().create({ transformer: superjson })
  const middleware = createInternalMiddleware('test-secret-value')

  const procedure = t.procedure.use(middleware)
  const router = t.router({ test: procedure.query(() => 'ok') })
  const caller = t.createCallerFactory(router)

  it('allows requests with valid secret', async () => {
    const result = await caller({ internalSecret: 'test-secret-value' }).test()
    expect(result).toBe('ok')
  })

  it('rejects requests with invalid secret', async () => {
    try {
      await caller({ internalSecret: 'wrong' }).test()
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError)
      expect((e as TRPCError).code).toBe('FORBIDDEN')
    }
  })

  it('rejects requests with no secret', async () => {
    try {
      await caller({ internalSecret: undefined }).test()
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError)
      expect((e as TRPCError).code).toBe('FORBIDDEN')
    }
  })

  it('rejects all requests when expected secret is empty', async () => {
    const emptyMiddleware = createInternalMiddleware('')
    const emptyProcedure = t.procedure.use(emptyMiddleware)
    const emptyRouter = t.router({ test: emptyProcedure.query(() => 'ok') })
    const emptyCaller = t.createCallerFactory(emptyRouter)

    try {
      await emptyCaller({ internalSecret: '' }).test()
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError)
      expect((e as TRPCError).code).toBe('FORBIDDEN')
    }
  })
})
