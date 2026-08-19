import { describe, expect, test } from 'bun:test'
import { resolveAccountTheme } from '../../src/components/AccountTheme'

const account = { id: 'account-id' }
const purplePreferences = { theme: 'purple' as const }
const ready = {
  account,
  accountLoading: false,
  accountError: false,
  preferences: purplePreferences,
  preferencesLoading: false,
  preferencesError: false,
}

describe('AccountTheme guards', () => {
  test('preserves the server theme while account or preferences state is loading or errored', () => {
    expect(resolveAccountTheme({ ...ready, accountLoading: true })).toBeNull()
    expect(resolveAccountTheme({ ...ready, accountError: true })).toBeNull()
    expect(resolveAccountTheme({ ...ready, preferencesLoading: true })).toBeNull()
    expect(resolveAccountTheme({ ...ready, preferencesError: true })).toBeNull()
  })

  test('applies the loaded account preference or neutral for anonymous state', () => {
    expect(resolveAccountTheme(ready)).toBe('purple')
    expect(resolveAccountTheme({ ...ready, account: null, preferences: null })).toBe('neutral')
  })
})
