import { describe, expect, test } from 'bun:test'
import {
  discordPlayerRefreshInputSchema,
  parsePlayerRefreshResponseOutput,
  parseRefreshOutcomeOutput,
  playerRefreshResponseSchema,
  refreshOutcomeSchema,
} from '../src'

const outcomes = [
  {
    outcome: 'accepted',
    operationId: '2ef5a585-e8b9-46df-8f95-53d03af42d11',
    retry: { kind: 'poll', afterSeconds: 2 },
  },
  {
    outcome: 'alreadyRefreshing',
    operationId: '2ef5a585-e8b9-46df-8f95-53d03af42d11',
    retry: { kind: 'poll', afterSeconds: 2 },
  },
  { outcome: 'notNeeded', retry: { kind: 'none' } },
  { outcome: 'verificationRequired', retry: { kind: 'verify' } },
  { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 900 } },
  { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
] as const

describe('canonical refresh outcome', () => {
  test('shares all six semantic fixtures with generated clients', async () => {
    const names = [
      'accepted',
      'already-refreshing',
      'not-needed',
      'verification-required',
      'rate-limited',
      'temporarily-unavailable',
    ]
    const fixtures = await Promise.all(
      names.map((name) => Bun.file(`${import.meta.dir}/fixtures/refresh-${name}.json`).json()),
    )
    expect(fixtures.map((value) => parseRefreshOutcomeOutput(value))).toEqual([...outcomes])
  })

  test('validates all six semantic outcomes with exact retry guidance', () => {
    expect(outcomes.map((value) => parseRefreshOutcomeOutput(value))).toEqual([...outcomes])
    expect(outcomes.map(({ outcome }) => outcome)).toEqual([
      'accepted',
      'alreadyRefreshing',
      'notNeeded',
      'verificationRequired',
      'rateLimited',
      'temporarilyUnavailable',
    ])
  })

  test.each([
    { outcome: 'accepted', operationId: 'not-a-uuid', retry: { kind: 'poll', afterSeconds: 2 } },
    { outcome: 'accepted', operationId: crypto.randomUUID(), retry: { kind: 'none' } },
    { outcome: 'notNeeded', retry: { kind: 'poll', afterSeconds: 2 } },
    { outcome: 'verificationRequired', retry: { kind: 'verify', afterSeconds: 1 } },
    { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 0 } },
    { outcome: 'temporarilyUnavailable', retry: { kind: 'after' } },
    { outcome: 'unknown', retry: { kind: 'none' } },
  ])('rejects malformed semantic output %#', (value) => {
    expect(() => refreshOutcomeSchema.parse(value)).toThrow()
  })

  test('accepts only a strict trusted Discord player refresh identity', () => {
    expect(discordPlayerRefreshInputSchema.parse({ id: 42, discordUserId: '123456789012345678' })).toEqual({
      id: 42,
      discordUserId: '123456789012345678',
    })
    expect(() => discordPlayerRefreshInputSchema.parse({ id: 42, discordUserId: '' })).toThrow()
    expect(() => discordPlayerRefreshInputSchema.parse({ id: 42, discordUserId: 'invented-user' })).toThrow()
    expect(() => discordPlayerRefreshInputSchema.parse({ id: 42, discordUserId: '00000000000000000' })).toThrow()
    expect(() => discordPlayerRefreshInputSchema.parse({ id: 42, discordUserId: '18446744073709551616' })).toThrow()
    expect(discordPlayerRefreshInputSchema.parse({ id: 42, discordUserId: '18446744073709551615' }).discordUserId).toBe(
      '18446744073709551615',
    )
    expect(() =>
      discordPlayerRefreshInputSchema.parse({
        id: 42,
        discordUserId: '123456789012345678',
        turnstileToken: 'spoofed',
      }),
    ).toThrow()
  })

  test('returns unchanged cached PlayerReference for every outcome and rejects persistence fields', () => {
    for (const refresh of outcomes) {
      const response = { player: { brawlhallaId: 42, name: 'Cached Ada' }, refresh }
      expect(parsePlayerRefreshResponseOutput(response)).toEqual(response)
    }
    expect(playerRefreshResponseSchema.parse({ player: null, refresh: outcomes[2] })).toEqual({
      player: null,
      refresh: outcomes[2],
    })
    expect(() =>
      playerRefreshResponseSchema.parse({
        player: { brawlhallaId: 42, name: 'Cached Ada', rating: 2000 },
        refresh: outcomes[3],
      }),
    ).toThrow()
  })
})
