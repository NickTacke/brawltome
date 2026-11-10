import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { bindSaltToServer } from '../src/visits/server-bound-salt'

const serverSecret = 'a'.repeat(32)
const otherServerSecret = 'b'.repeat(32)

function hex(salt: Uint8Array): string {
  return Buffer.from(salt).toString('hex')
}

describe('salt bound to the server', () => {
  test('every api process with the same secret gets the same salt from a stored one', () => {
    const storedSalt = randomBytes(32)

    expect(hex(bindSaltToServer(serverSecret, storedSalt))).toBe(hex(bindSaltToServer(serverSecret, storedSalt)))
    expect(bindSaltToServer(serverSecret, storedSalt)).toHaveLength(32)
  })

  test('the stored salt alone, as a backup holds it, is not the salt the keys are made with', () => {
    const storedSalt = randomBytes(32)

    expect(hex(bindSaltToServer(serverSecret, storedSalt))).not.toBe(hex(storedSalt))

    expect(hex(bindSaltToServer(serverSecret, storedSalt))).not.toBe(
      hex(bindSaltToServer(otherServerSecret, storedSalt)),
    )
  })

  test('a new stored salt gives a new salt, so the day change still replaces it', () => {
    const today = bindSaltToServer(serverSecret, randomBytes(32))
    const tomorrow = bindSaltToServer(serverSecret, randomBytes(32))

    expect(hex(tomorrow)).not.toBe(hex(today))
  })
})
