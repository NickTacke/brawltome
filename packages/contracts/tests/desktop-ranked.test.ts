import { describe, expect, test } from 'bun:test'
import { generateContractOpenApi, parseDesktopRankedLookupOutput } from '../src'

describe('desktop ranked lookup contract', () => {
  test('preserves measured zero and nullable ranked values from the shared fixture', async () => {
    const fixture = await Bun.file(`${import.meta.dir}/fixtures/desktop-ranked-measured-zero.json`).json()

    expect(parseDesktopRankedLookupOutput(fixture)).toEqual(fixture)
  })

  test('shares missing, unavailable, stale, blocked, and refreshing fixtures with Rust', async () => {
    const names = [
      'missing-accepted',
      'unavailable-verification-required',
      'stale-already-refreshing',
      'stale-rate-limited',
      'stale-temporarily-unavailable',
    ]
    const fixtures = await Promise.all(
      names.map((name) => Bun.file(`${import.meta.dir}/fixtures/desktop-ranked-${name}.json`).json()),
    )

    expect(fixtures.map((fixture) => parseDesktopRankedLookupOutput(fixture))).toEqual(fixtures)
    expect(fixtures.map((fixture) => fixture.refresh.outcome)).toEqual([
      'accepted',
      'verificationRequired',
      'alreadyRefreshing',
      'rateLimited',
      'temporarilyUnavailable',
    ])
  })

  test('declares the preserved desktop lookup route for generated clients', () => {
    const operation = generateContractOpenApi().paths['/api/overlay/opponent/{brawlhallaId}']?.get

    expect(operation).toMatchObject({
      operationId: 'getDesktopRankedLookup',
      parameters: [
        {
          in: 'path',
          name: 'brawlhallaId',
          required: true,
          schema: { type: 'integer', minimum: 0, exclusiveMinimum: true, maximum: 2_147_483_647 },
        },
      ],
      responses: { 200: expect.any(Object) },
    })
  })

  test('rejects malformed, non-UTC, contradictory, and unknown transport values', async () => {
    const fixture = await Bun.file(`${import.meta.dir}/fixtures/desktop-ranked-measured-zero.json`).json()
    const { ranked: _ranked, ...missingRanked } = fixture

    for (const invalid of [
      missingRanked,
      { ...fixture, ranked: { ...fixture.ranked, checkedAt: '2026-08-09T22:00:00+00:00' } },
      { ...fixture, persistenceStatus: 'loaded' },
      {
        ...fixture,
        ranked: {
          ...fixture.ranked,
          lastSuccessAt: null,
          freshness: 'fresh',
          snapshot: null,
        },
      },
    ]) {
      expect(() => parseDesktopRankedLookupOutput(invalid)).toThrow()
    }
  })
})
