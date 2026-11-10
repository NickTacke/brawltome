import {
  type AccountPinnedPlayersContract,
  type AccountSessionContract,
  type PrimaryPlayerVerificationStateContract,
  parsePrimaryPlayerVerificationStateOutput,
} from '@brawltome/contracts'
import type { AccountAuthentication, PinnedPlayer, PrimaryPlayerVerificationState } from '../src/accounts'

export function toAccountSession(authentication: AccountAuthentication): AccountSessionContract {
  if (authentication.status === 'anonymous') return { status: 'anonymous' }

  const { account, expiresAt, extended } = authentication

  return {
    status: 'signedIn',
    account: {
      id: account.id,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      createdAt: account.createdAt.toISOString(),
    },
    sessionRenewedUntil: extended ? expiresAt.toISOString() : null,
  }
}

export function toAccountPinnedPlayers(pinnedPlayers: readonly PinnedPlayer[]): AccountPinnedPlayersContract {
  return pinnedPlayers.map(({ brawlhallaId, order, pinnedAt }) => ({
    brawlhallaId,
    order,
    pinnedAt: pinnedAt.toISOString(),
  }))
}

export function toVerificationState(state: PrimaryPlayerVerificationState): PrimaryPlayerVerificationStateContract {
  const primaryPlayer = state.primaryPlayer
    ? { ...state.primaryPlayer, verifiedAt: state.primaryPlayer.verifiedAt.toISOString() }
    : null

  const attempts = state.attempts.map((attempt) => ({
    ...attempt,
    startedAt: attempt.startedAt.toISOString(),
    completedAt: attempt.completedAt?.toISOString() ?? null,
  }))

  // the contract ties completedAt and player to each status, which the store's flat attempt type can't express
  return parsePrimaryPlayerVerificationStateOutput({ primaryPlayer, attempts })
}
