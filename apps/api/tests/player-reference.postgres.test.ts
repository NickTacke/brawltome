import { describe, expect, test } from 'bun:test'
import { randomInt } from 'node:crypto'
import { type Database, db, player } from '@brawltome/database'
import { createDatabasePlayerReferenceQueries } from '../src/adapters/player-reference.database'

describe('stored Player Reference', () => {
  test('reads canonical identity while hiding persistence fields and placeholders', async () => {
    const storedId = randomInt(1_500_000_000, 2_000_000_000)
    const placeholderId = storedId + 1
    const rankedId = storedId + 2
    const careerId = storedId + 3
    const staleCareerId = storedId + 4
    const invalidCareerId = storedId + 5
    const bothStaleId = storedId + 6
    const storedMetadataId = storedId + 7
    const now = new Date('2026-08-14T12:00:00.000Z')
    const fresh = new Date('2026-08-14T11:00:00.000Z')
    const stale = new Date('2026-08-13T00:00:00.000Z')
    const newerStale = new Date('2026-08-13T01:00:00.000Z')
    const rollback = new Error('rollback Player Reference integration test')

    try {
      await db.transaction(async (transaction) => {
        await transaction.insert(player).values([
          { brawlhallaId: storedId, name: 'Canonical Player', rating: 0 },
          { brawlhallaId: placeholderId, name: `Player ${placeholderId}`, rating: 0 },
          { brawlhallaId: storedMetadataId, name: 'Stored Name', rating: 0 },
        ])

        const queries = createDatabasePlayerReferenceQueries(
          transaction as unknown as Database,
          async (brawlhallaId) => {
            if (brawlhallaId === rankedId) {
              return {
                brawlhallaId,
                name: 'Canonical Ranked Player',
                bestLegendNameKey: 'teros',
                legacyRating: 2_000,
                lastSuccessAt: fresh,
              }
            }
            if (brawlhallaId === staleCareerId || brawlhallaId === invalidCareerId) {
              return { brawlhallaId, name: 'Fresh Ranked Name', lastSuccessAt: fresh }
            }
            if (brawlhallaId === bothStaleId) {
              return { brawlhallaId, name: 'Older Stale Ranked Name', lastSuccessAt: stale }
            }
            if (brawlhallaId === storedMetadataId) {
              return {
                brawlhallaId,
                name: `Player ${brawlhallaId}`,
                bestLegendNameKey: 'teros',
                legacyRating: 1_800,
                lastSuccessAt: fresh,
              }
            }
            return null
          },
          async (brawlhallaId) => {
            if (brawlhallaId === rankedId) {
              return { brawlhallaId, name: 'Career Name', bestLegendNameKey: 'ragnir', lastSuccessAt: fresh }
            }
            if (brawlhallaId === careerId) {
              return { brawlhallaId, name: 'Canonical Career Player', lastSuccessAt: fresh }
            }
            if (brawlhallaId === staleCareerId) {
              return { brawlhallaId, name: 'Newer Stale Career Name', lastSuccessAt: newerStale }
            }
            if (brawlhallaId === invalidCareerId) {
              return { brawlhallaId, name: `Player ${brawlhallaId}`, lastSuccessAt: fresh }
            }
            if (brawlhallaId === bothStaleId) {
              return { brawlhallaId, name: 'Newer Stale Career Name', lastSuccessAt: newerStale }
            }
            return null
          },
          () => now,
        )

        expect(await queries.byId(storedId)).toEqual({ brawlhallaId: storedId, name: 'Canonical Player' })
        expect(await queries.byId(rankedId)).toEqual({
          brawlhallaId: rankedId,
          name: 'Career Name',
          bestLegendNameKey: 'teros',
          legacyRating: 2_000,
        })
        expect(await queries.byId(careerId)).toEqual({ brawlhallaId: careerId, name: 'Canonical Career Player' })
        expect(await queries.byId(staleCareerId)).toEqual({ brawlhallaId: staleCareerId, name: 'Fresh Ranked Name' })
        expect(await queries.byId(invalidCareerId)).toEqual({
          brawlhallaId: invalidCareerId,
          name: 'Fresh Ranked Name',
        })
        expect(await queries.byId(bothStaleId)).toEqual({
          brawlhallaId: bothStaleId,
          name: 'Newer Stale Career Name',
        })
        expect(await queries.byId(storedMetadataId)).toEqual({
          brawlhallaId: storedMetadataId,
          name: 'Stored Name',
          bestLegendNameKey: 'teros',
          legacyRating: 1_800,
        })
        expect(await queries.byId(placeholderId)).toBeNull()
        expect(await queries.byId(storedId - 1)).toBeNull()
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})
