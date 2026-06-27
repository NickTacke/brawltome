import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { db, legend } from '@brawltome/database'
import { getLegendById, initGameData } from '@brawltome/shared'
import { eq } from 'drizzle-orm'

// Guards the prod regression: when the legends API refresh fails (rate-limited during a multi-app
// restart), initGameData falls back to existing DB rows. Those rows may hold the raw uppercase v1
// legend_name from an older version, which would 404 the avatar assets. The cache must normalize them.
const STALE_ID = 9301

describe('initGameData normalizes legend slugs from the DB fallback', () => {
  beforeAll(async () => {
    await db
      .insert(legend)
      .values({
        legendId: STALE_ID,
        legendNameKey: 'LORD VRAXX', // simulates a row written from the raw uppercase v1 name
        bioName: 'Test',
        bioAka: '',
        bioQuote: '',
        bioQuoteAboutAttrib: '',
        bioQuoteFrom: '',
        bioQuoteFromAttrib: '',
        bioText: '',
        botName: '',
        weaponOne: 'Hammer',
        weaponTwo: 'Sword',
        strength: '0',
        dexterity: '0',
        defense: '0',
        speed: '0',
      })
      .onConflictDoUpdate({ target: legend.legendId, set: { legendNameKey: 'LORD VRAXX' } })
    await initGameData(db) // no bhapi -> load + normalize from DB
  })

  afterAll(async () => {
    await db.delete(legend).where(eq(legend.legendId, STALE_ID))
  })

  it('lowercases + deaccents the cached slug even from a stale DB row', () => {
    expect(getLegendById(STALE_ID)?.legendNameKey).toBe('lord vraxx')
  })
})
