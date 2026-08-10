import type { Account, AccountPreferences, PrimaryPlayerVerificationState, SavedPlayer } from '@brawltome/accounts'
import {
  type AccountPreferencesContract,
  type AccountViewContract,
  type PlayerRankedProfileContract,
  type PlayerReferenceContract,
  type PrimaryPlayerVerificationStateContract,
  type SavedPlayersContract,
  accountPreferencesSchema,
  parseAccountViewOutput,
  parsePrimaryPlayerVerificationStateOutput,
  parseSavedPlayersOutput,
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

export function toSavedPlayers(
  savedPlayers: readonly SavedPlayer[],
  facts: ReadonlyMap<
    number,
    { player: PlayerReferenceContract | null; currentSeason: PlayerRankedProfileContract | null }
  >,
): SavedPlayersContract {
  return parseSavedPlayersOutput(
    savedPlayers.map((savedPlayer) => ({
      ...savedPlayer,
      savedAt: savedPlayer.savedAt.toISOString(),
      player: facts.get(savedPlayer.brawlhallaId)?.player ?? null,
      currentSeason: facts.get(savedPlayer.brawlhallaId)?.currentSeason ?? null,
    })),
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
