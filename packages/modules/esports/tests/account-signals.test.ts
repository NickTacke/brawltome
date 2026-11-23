import { describe, expect, test } from 'bun:test'
import type { Database } from '@brawltome/foundation'
import { readAccountSignals } from '../api/account-signals'

const refused = new Error('connection refused')

// every query fails, the way it would with the database down
function unreachableDatabase(): Database {
  const sql = Object.assign(() => Promise.reject(refused), { begin: () => Promise.reject(refused) })

  return { sql } as unknown as Database
}

describe('readAccountSignals', () => {
  test('says which player it failed to read, with the cause', async () => {
    const reading = readAccountSignals(unreachableDatabase(), 42)

    await expect(reading).rejects.toThrow('read account signals for player 42: connection refused')
    await expect(reading).rejects.toMatchObject({ cause: refused })
  })
})
