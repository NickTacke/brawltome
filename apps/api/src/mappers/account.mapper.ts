import type {
  Account,
  AccountPreferences,
  PlayerShortcuts,
  PrimaryPlayerVerificationState,
  SavedPlayer,
} from '@brawltome/accounts'
import {
  type AccountPreferencesContract,
  type AccountViewContract,
  type PlayerRankedProfileContract,
  type PlayerReferenceContract,
  type PlayerShortcutsContract,
  type PrimaryPlayerVerificationStateContract,
  type SavedPlayersContract,
  accountPreferencesSchema,
  parseAccountViewOutput,
  parsePlayerShortcutsOutput,
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

export interface AccountPlayerFacts {
  player: PlayerReferenceContract | null
  currentSeason: PlayerRankedProfileContract | null
}

export function toSavedPlayers(
  savedPlayers: readonly SavedPlayer[],
  facts: ReadonlyMap<number, AccountPlayerFacts>,
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

export function toPlayerShortcuts(
  shortcuts: PlayerShortcuts,
  facts: ReadonlyMap<number, AccountPlayerFacts>,
): PlayerShortcutsContract {
  const mapShortcut = (brawlhallaId: number, fallbackName: string | null = null) => {
    const playerFacts = facts.get(brawlhallaId)
    const mainLegend = playerFacts?.currentSeason?.snapshot?.mainLegend ?? null
    return {
      brawlhallaId,
      name: playerFacts?.player?.name ?? fallbackName,
      mainLegend: mainLegend ? { legendNameKey: mainLegend.legendNameKey, source: mainLegend.source } : null,
    }
  }
  return parsePlayerShortcutsOutput({
    primary: shortcuts.primaryPlayer
      ? mapShortcut(shortcuts.primaryPlayer.brawlhallaId, shortcuts.primaryPlayer.name)
      : null,
    pins: shortcuts.pinnedPlayers.map(({ brawlhallaId }) => mapShortcut(brawlhallaId)),
  })
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
