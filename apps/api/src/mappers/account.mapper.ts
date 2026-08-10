import type { Account, AccountPreferences } from '@brawltome/accounts'
import {
  type AccountPreferencesContract,
  type AccountViewContract,
  accountPreferencesSchema,
  parseAccountViewOutput,
} from '@brawltome/contracts'

export function toAccountPreferences(preferences: AccountPreferences): AccountPreferencesContract {
  return accountPreferencesSchema.parse(preferences)
}

export function toAccountView(account: Account | null): AccountViewContract {
  return parseAccountViewOutput(
    account
      ? {
          status: 'signedIn',
          account: {
            id: account.id,
            displayName: account.displayName,
            avatarUrl: account.avatarUrl,
            createdAt: account.createdAt.toISOString(),
          },
        }
      : { status: 'anonymous' },
  )
}
