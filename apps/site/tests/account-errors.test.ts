import { describe, expect, test } from 'bun:test'
import { accountErrorMessage, parseAccountError } from '../src/components/account/account-errors'

// the api sends sign-in and steam failures back to /account?error=<code> (apps/api/src/auth/routes.ts)
const apiErrorCodes = ['state', 'discord', 'server', 'auth', 'steam', 'rate_limited']

describe('account errors', () => {
  test.each(apiErrorCodes)('has a message for the api code %s', (code) => {
    const error = parseAccountError(code)

    expect(error).toBe(code as never)
    expect(accountErrorMessage(error)).toBeTruthy()
  })

  test.each([undefined, '', 'unknown', '<script>', 42])('ignores %p', (value) => {
    expect(parseAccountError(value)).toBeUndefined()
    expect(accountErrorMessage(parseAccountError(value))).toBeNull()
  })
})
