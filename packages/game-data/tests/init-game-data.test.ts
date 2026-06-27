import { describe, expect, it } from 'bun:test'
import { initGameData } from '@brawltome/shared'

// Minimal stubs - no real Postgres or API needed
function makeDb(firstFindMany: unknown[] = [], secondFindMany: unknown[] = []) {
  let findManyCall = 0
  return {
    query: {
      legend: {
        findMany: async () => {
          findManyCall++
          return findManyCall === 1 ? firstFindMany : secondFindMany
        },
      },
    },
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => {},
      }),
    }),
  }
}

function makeBhapi(legends: unknown[]) {
  return {
    getAllLegendsV1: async () => legends,
  }
}

describe('initGameData', () => {
  it('throws when getAllLegendsV1 returns empty array', async () => {
    const db = makeDb([], [])
    const bhapi = makeBhapi([])
    await expect(initGameData(db as never, bhapi as never)).rejects.toThrow('returned no legends')
  })

  it('throws when insert produces no rows', async () => {
    const fakeApiLegend = {
      legend_id: 1,
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
    // First findMany (check DB) -> empty; second (after insert) -> empty
    const db = makeDb([], [])
    const bhapi = makeBhapi([fakeApiLegend])
    await expect(initGameData(db as never, bhapi as never)).rejects.toThrow('legend insert produced no rows')
  })
})
