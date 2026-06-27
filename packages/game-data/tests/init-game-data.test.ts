import { describe, expect, it } from 'bun:test'
import { getLegendById, initGameData } from '@brawltome/shared'

const fakeApiLegend = {
  legend_id: 3,
  legend_name: 'bodvar',
  bio_name: 'Bödvar',
  bio_aka: '',
  bio_quote: '',
  bio_quote_about_attrib: '',
  bio_quote_from: '',
  bio_quote_from_attrib: '',
  bio_text: '',
  bot_name: '',
  weapon_one: 'Hammer',
  weapon_two: 'Sword',
  strength: 6,
  dexterity: 6,
  defense: 4,
  speed: 4,
}

const fakeDbLegend = {
  legendId: 3,
  legendNameKey: 'bodvar',
  bioName: 'Bödvar',
  bioAka: '',
  bioQuoteAboutAttrib: '',
  weaponOne: 'Hammer',
  weaponTwo: 'Sword',
}

function makeDb(dbLegends: unknown[] = []) {
  return {
    query: {
      legend: {
        findMany: async () => dbLegends,
      },
    },
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => {},
      }),
    }),
  }
}

describe('initGameData', () => {
  it('API fetch rejects -> resilient fallback to existing DB legends', async () => {
    const bhapi = {
      getAllLegendsV1: async () => {
        throw new Error('network error')
      },
    }
    const db = makeDb([fakeDbLegend])
    await expect(initGameData(db as never, bhapi as never)).resolves.toBeUndefined()
    expect(getLegendById(3)).toBeDefined()
  })

  it('API empty + DB empty -> resolves without throwing', async () => {
    const bhapi = { getAllLegendsV1: async () => [] }
    const db = makeDb([])
    await expect(initGameData(db as never, bhapi as never)).resolves.toBeUndefined()
  })

  it('no bhapi -> loads from DB', async () => {
    const db = makeDb([fakeDbLegend])
    await expect(initGameData(db as never)).resolves.toBeUndefined()
    expect(getLegendById(3)).toBeDefined()
  })
})
