import { describe, expect, test } from 'bun:test'
import { call } from '@orpc/server'
import { internalProcedure, publicProcedure } from '../procedures'

const internalEcho = internalProcedure.handler(() => 'served')
const publicEcho = publicProcedure.handler(() => 'served')

describe('oRPC base procedures', () => {
  test('an internal procedure serves an internal caller', async () => {
    await expect(call(internalEcho, undefined, { context: { isInternalCaller: true } })).resolves.toBe('served')
  })

  test('an internal procedure refuses any other caller with FORBIDDEN', async () => {
    const refused = call(internalEcho, undefined, { context: { isInternalCaller: false } })

    await expect(refused).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })

  test('a public procedure serves every caller', async () => {
    await expect(call(publicEcho, undefined, { context: { isInternalCaller: false } })).resolves.toBe('served')
  })

  test('an internal procedure declares the internal secret in its OpenAPI operation', () => {
    const spec = internalEcho['~orpc'].route.spec

    expect(typeof spec).toBe('function')

    if (typeof spec !== 'function') return

    expect(spec({ responses: {} }).security).toEqual([{ internalSecret: [] }])
  })
})
