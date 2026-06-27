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
    getAllLegends: async () => legends,
  }
}

describe('initGameData', () => {
  it('throws when getAllLegends returns empty array', async () => {
    const db = makeDb([], [])
    const bhapi = makeBhapi([])
    await expect(initGameData(db as never, bhapi as never)).rejects.toThrow('returned no legends')
  })

  it('throws when insert produces no rows', async () => {
    const fakeApiLegend = {
      legend_id: 1,
      legend_name_key: 'bodvar',
      bio_name: 'Bödvar',
      bio_aka: '',
      weapon_one: 'Hammer',
      weapon_two: 'Sword',
      strength: '6',
      dexterity: '6',
      defense: '4',
      speed: '4',
    }
    // First findMany (check DB) -> empty; second (after insert) -> empty
    const db = makeDb([], [])
    const bhapi = makeBhapi([fakeApiLegend])
    await expect(initGameData(db as never, bhapi as never)).rejects.toThrow('legend insert produced no rows')
  })
})
