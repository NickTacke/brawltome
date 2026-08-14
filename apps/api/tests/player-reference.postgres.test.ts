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
    const careerPriorityId = storedId + 4
    const invalidCareerId = storedId + 5
    const storedMetadataId = storedId + 6
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
              }
            }
            if (brawlhallaId === careerPriorityId || brawlhallaId === invalidCareerId) {
              return { brawlhallaId, name: 'Ranked Name' }
            }
            if (brawlhallaId === storedMetadataId) {
              return {
                brawlhallaId,
                name: `Player ${brawlhallaId}`,
                bestLegendNameKey: 'teros',
                legacyRating: 1_800,
              }
            }
            return null
          },
          async (brawlhallaId) => {
            if (brawlhallaId === rankedId) {
              return { brawlhallaId, name: 'Career Name', bestLegendNameKey: 'ragnir' }
            }
            if (brawlhallaId === careerId) {
              return { brawlhallaId, name: 'Canonical Career Player' }
            }
            if (brawlhallaId === careerPriorityId) {
              return { brawlhallaId, name: 'Career Name' }
            }
            if (brawlhallaId === invalidCareerId) {
              return { brawlhallaId, name: `Player ${brawlhallaId}` }
            }
            return null
          },
        )

        expect(await queries.byId(storedId)).toEqual({ brawlhallaId: storedId, name: 'Canonical Player' })
        expect(await queries.byId(rankedId)).toEqual({
          brawlhallaId: rankedId,
          name: 'Career Name',
          bestLegendNameKey: 'teros',
          legacyRating: 2_000,
        })
        expect(await queries.byId(careerId)).toEqual({ brawlhallaId: careerId, name: 'Canonical Career Player' })
        expect(await queries.byId(careerPriorityId)).toEqual({ brawlhallaId: careerPriorityId, name: 'Career Name' })
        expect(await queries.byId(invalidCareerId)).toEqual({
          brawlhallaId: invalidCareerId,
          name: 'Ranked Name',
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
