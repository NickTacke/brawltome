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
    const rollback = new Error('rollback Player Reference integration test')

    try {
      await db.transaction(async (transaction) => {
        await transaction.insert(player).values([
          { brawlhallaId: storedId, name: 'Canonical Player', rating: 0 },
          { brawlhallaId: placeholderId, name: `Player ${placeholderId}`, rating: 0 },
        ])

        const queries = createDatabasePlayerReferenceQueries(
          transaction as unknown as Database,
          async (brawlhallaId) =>
            brawlhallaId === rankedId ? { brawlhallaId, name: 'Canonical Ranked Player' } : null,
          async (brawlhallaId) =>
            brawlhallaId === careerId ? { brawlhallaId, name: 'Canonical Career Player' } : null,
        )

        expect(await queries.byId(storedId)).toEqual({ brawlhallaId: storedId, name: 'Canonical Player' })
        expect(await queries.byId(rankedId)).toEqual({
          brawlhallaId: rankedId,
          name: 'Canonical Ranked Player',
          bestLegendNameKey: null,
        })
        expect(await queries.byId(careerId)).toEqual({ brawlhallaId: careerId, name: 'Canonical Career Player' })
        expect(await queries.byId(placeholderId)).toBeNull()
        expect(await queries.byId(storedId - 1)).toBeNull()
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})
