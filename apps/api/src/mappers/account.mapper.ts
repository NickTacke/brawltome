import type {
  Account,
  AccountPreferences,
  PinnedPlayer,
  PlayerShortcuts,
  PrimaryPlayerVerificationState,
} from '@brawltome/accounts'
import {
  type AccountPreferencesContract,
  type AccountViewContract,
  type PinnedPlayersContract,
  type PlayerRankedProfileContract,
  type PlayerReferenceContract,
  type PlayerShortcutsContract,
  type PrimaryPlayerVerificationStateContract,
  accountPreferencesSchema,
  parseAccountViewOutput,
  parsePinnedPlayersOutput,
  parsePlayerShortcutsOutput,
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

export interface AccountPlayerFacts {
  player: PlayerReferenceContract | null
  currentSeason: PlayerRankedProfileContract | null
}

export function toPinnedPlayers(
  pinnedPlayers: readonly PinnedPlayer[],
  facts: ReadonlyMap<number, AccountPlayerFacts>,
): PinnedPlayersContract {
  return parsePinnedPlayersOutput(
    pinnedPlayers.map((pinnedPlayer) => ({
      ...pinnedPlayer,
      pinnedAt: pinnedPlayer.pinnedAt.toISOString(),
      player: facts.get(pinnedPlayer.brawlhallaId)?.player ?? null,
      currentSeason: facts.get(pinnedPlayer.brawlhallaId)?.currentSeason ?? null,
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
    pins: shortcuts.pinnedPlayers
      .filter(({ brawlhallaId }) => brawlhallaId !== shortcuts.primaryPlayer?.brawlhallaId)
      .map(({ brawlhallaId }) => mapShortcut(brawlhallaId)),
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
