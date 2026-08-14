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

function makeDb(dbLegends: Array<Record<string, unknown>> = []) {
  const rows = [...dbLegends]
  return {
    query: {
      legend: {
        findMany: async () => rows,
      },
    },
    insert: () => ({
      values: (values: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const incoming = Array.isArray(values) ? values : [values]
        const upsert = (overwrite: boolean) => {
          for (const value of incoming) {
            const index = rows.findIndex((row) => row.legendId === value.legendId)
            if (index < 0) rows.push(value)
            else if (overwrite) rows[index] = { ...rows[index], ...value }
          }
        }
        return {
          onConflictDoNothing: async () => upsert(false),
          onConflictDoUpdate: async () => upsert(true),
        }
      },
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

  it('seeds committed legends when the API list lags', async () => {
    const bhapi = { getAllLegendsV1: async () => [fakeApiLegend] }
    const db = makeDb([])
    await expect(initGameData(db as never, bhapi as never)).resolves.toBeUndefined()
    expect(getLegendById(71)).toMatchObject({ legendNameKey: 'aurus', bioName: 'Aurus' })
    expect(getLegendById(1)).toBeUndefined()
    expect(getLegendById(2)).toBeUndefined()
  })

  it('no bhapi -> loads from DB', async () => {
    const db = makeDb([fakeDbLegend])
    await expect(initGameData(db as never)).resolves.toBeUndefined()
    expect(getLegendById(3)).toBeDefined()
  })
})
