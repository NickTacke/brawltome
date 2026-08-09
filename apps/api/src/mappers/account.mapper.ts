import type { Account } from '@brawltome/accounts'
import { type AccountViewContract, parseAccountViewOutput } from '@brawltome/contracts'

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
