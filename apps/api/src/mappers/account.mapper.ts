import type { Account, AccountPreferences, PrimaryPlayerVerificationState } from '@brawltome/accounts'
import {
  type AccountPreferencesContract,
  type AccountViewContract,
  type PrimaryPlayerVerificationStateContract,
  accountPreferencesSchema,
  parseAccountViewOutput,
  parsePrimaryPlayerVerificationStateOutput,
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

export function toPrimaryPlayerVerificationState(
  state: PrimaryPlayerVerificationState,
): PrimaryPlayerVerificationStateContract {
  return parsePrimaryPlayerVerificationStateOutput({
    primaryPlayer: state.primaryPlayer
      ? { ...state.primaryPlayer, verifiedAt: state.primaryPlayer.verifiedAt.toISOString() }
      : null,
    attempts: state.attempts.map((attempt) => ({
      ...attempt,
      startedAt: attempt.startedAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
    })),
  })
}
