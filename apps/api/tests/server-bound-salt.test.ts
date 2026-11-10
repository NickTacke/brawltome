import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { createServerBoundSalts } from '../src/visits/server-bound-salt'

const serverSecret = 'a'.repeat(32)
const otherServerSecret = 'b'.repeat(32)
const day = '2026-11-10'

function hex(salt: Uint8Array): string {
  return Buffer.from(salt).toString('hex')
}

// stands in for the database: the same stored salt for every process that asks
function createStore() {
  const storedSalt = randomBytes(32)

  return { storedSalt, storedSaltFor: async () => storedSalt }
}

describe('salt bound to the server', () => {
  test('every api process with the same secret gets the same salt from a stored one', async () => {
    const { storedSaltFor } = createStore()
    const oneProcess = createServerBoundSalts({ serverSecret, storedSaltFor })
    const otherProcess = createServerBoundSalts({ serverSecret, storedSaltFor })

    expect(hex(await otherProcess(day))).toBe(hex(await oneProcess(day)))
    expect(await oneProcess(day)).toHaveLength(32)
  })

  test('the stored salt alone, as a backup holds it, is not the salt the keys are made with', async () => {
    const { storedSalt, storedSaltFor } = createStore()
    const salt = await createServerBoundSalts({ serverSecret, storedSaltFor })(day)
    const saltElsewhere = await createServerBoundSalts({ serverSecret: otherServerSecret, storedSaltFor })(day)

    expect(hex(salt)).not.toBe(hex(storedSalt))
    expect(hex(salt)).not.toBe(hex(saltElsewhere))
  })

  test('asks for the stored salt of the day it was asked for', async () => {
    const askedDays: string[] = []

    const storedSaltFor = async (askedDay: string) => {
      askedDays.push(askedDay)

      return randomBytes(32)
    }

    await createServerBoundSalts({ serverSecret, storedSaltFor })(day)

    expect(askedDays).toEqual([day])
  })
})
