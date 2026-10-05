import { describe, expect, test } from 'bun:test'
import { randomInt } from 'node:crypto'
import { type Database, db } from '@brawltome/database'
import { sql } from 'drizzle-orm'
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
    const renamedId = storedId + 7
    const leaderboardOnlyId = storedId + 8
    const rollback = new Error('rollback Player Reference integration test')

    try {
      await db.transaction(async (transaction) => {
        const archiveChecksum = 'a'.repeat(64)
        await transaction.execute(sql`
          INSERT INTO players.discovery_aliases (brawlhalla_id, normalized_alias, display_alias, observed_at)
          VALUES
            (${storedId}, 'canonical alias', 'Canonical Alias', '2026-08-10T00:00:00Z'),
            (${storedId}, 'stored player', 'STORED PLAYER', '2026-08-10T00:00:00Z')
        `)
        await transaction.execute(sql`
          INSERT INTO players.legacy_discovery_aliases
            (brawlhalla_id, normalized_alias, display_alias, observed_at, archive_checksum)
          VALUES
            (${storedId}, 'canonical alias', 'CANONICAL ALIAS', '2026-08-09T00:00:00Z', ${archiveChecksum}),
            (${storedId}, 'older alias', 'Older Alias', '2026-08-08T00:00:00Z', ${archiveChecksum})
        `)

        const queries = createDatabasePlayerReferenceQueries(
          transaction as unknown as Database,
          async (brawlhallaId) => {
            if (brawlhallaId === storedId) {
              return {
                brawlhallaId,
                name: 'Stored Player',
                bestLegendNameKey: 'bodvar',
                legacyRating: 1_800,
              }
            }
            if (brawlhallaId === placeholderId) return { brawlhallaId, name: `Player ${brawlhallaId}` }
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
            if (brawlhallaId === renamedId) {
              return { brawlhallaId, name: 'Renamed Player', observedAt: new Date('2026-10-05T12:00:00Z') }
            }
            if (brawlhallaId === storedMetadataId) {
              return {
                brawlhallaId,
                name: 'Stored Name',
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
            if (brawlhallaId === renamedId) {
              return { brawlhallaId, name: 'Legacy Career Name', observedAt: new Date('2024-01-01T00:00:00Z') }
            }
            return null
          },
          async (brawlhallaId) => {
            if (brawlhallaId === renamedId) {
              return { brawlhallaId, name: 'Older Leaderboard Name', observedAt: new Date('2026-10-01T00:00:00Z') }
            }
            if (brawlhallaId === leaderboardOnlyId) {
              return { brawlhallaId, name: 'Leaderboard Climber', observedAt: new Date('2026-10-05T00:00:00Z') }
            }
            return null
          },
        )

        expect(await queries.byId(storedId)).toEqual({
          brawlhallaId: storedId,
          name: 'Stored Player',
          aliases: ['Canonical Alias', 'Older Alias'],
          bestLegendNameKey: 'bodvar',
          legacyRating: 1_800,
        })
        expect(await queries.byId(rankedId)).toEqual({
          brawlhallaId: rankedId,
          name: 'Career Name',
          aliases: [],
          bestLegendNameKey: 'teros',
          legacyRating: 2_000,
        })
        expect(await queries.byId(careerId)).toEqual({
          brawlhallaId: careerId,
          name: 'Canonical Career Player',
          aliases: [],
        })
        expect(await queries.byId(careerPriorityId)).toEqual({
          brawlhallaId: careerPriorityId,
          name: 'Career Name',
          aliases: [],
        })
        expect(await queries.byId(invalidCareerId)).toEqual({
          brawlhallaId: invalidCareerId,
          name: 'Ranked Name',
          aliases: [],
        })
        expect(await queries.byId(storedMetadataId)).toEqual({
          brawlhallaId: storedMetadataId,
          name: 'Stored Name',
          aliases: [],
          bestLegendNameKey: 'teros',
          legacyRating: 1_800,
        })
        expect(await queries.byId(renamedId)).toEqual({ brawlhallaId: renamedId, name: 'Renamed Player', aliases: [] })
        expect(await queries.byId(leaderboardOnlyId)).toEqual({
          brawlhallaId: leaderboardOnlyId,
          name: 'Leaderboard Climber',
          aliases: [],
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
