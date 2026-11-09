import { describe, expect, test } from 'bun:test'
import { playerViewInputSchema, playerViewResponseSchema } from '../src'

describe('player view', () => {
  test('takes a player id', () => {
    expect(playerViewInputSchema.parse({ id: 7 })).toEqual({ id: 7 })
    expect(playerViewInputSchema.safeParse({ id: 0 }).success).toBe(false)
  })

  test('answers whether the view was counted, and nothing else', () => {
    expect(playerViewResponseSchema.parse({ recorded: true })).toEqual({ recorded: true })
    expect(playerViewResponseSchema.safeParse({ recorded: true, ip: '203.0.113.9' }).success).toBe(false)
  })
})
