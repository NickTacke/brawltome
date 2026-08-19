import { describe, expect, test } from 'bun:test'
import {
  hasPinnedPlayerLimitReached,
  shouldShowPinnedPlayerButton,
} from '../../../src/components/player/PlayerProfile/player-profile-state'

describe('PlayerProfile pinned-player state', () => {
  test('hides the control until Primary Player state is known', () => {
    const base = {
      accountSignedIn: true,
      pinnedPlayersReady: true,
      playerId: 99,
      primaryPlayerId: null,
      primaryPlayerLoading: false,
      primaryPlayerError: false,
    }

    expect(shouldShowPinnedPlayerButton({ ...base, primaryPlayerLoading: true })).toBe(false)
    expect(shouldShowPinnedPlayerButton({ ...base, primaryPlayerError: true })).toBe(false)
    expect(shouldShowPinnedPlayerButton(base)).toBe(true)
    expect(shouldShowPinnedPlayerButton({ ...base, primaryPlayerId: 99 })).toBe(false)
  })

  test('excludes a retained Primary Player from the new-pin cap', () => {
    const primaryPlayer = { brawlhallaId: 42 }
    const managedPins = (count: number) => Array.from({ length: count }, (_, index) => ({ brawlhallaId: 100 + index }))

    expect(hasPinnedPlayerLimitReached([...managedPins(19), primaryPlayer], 42, 999)).toBe(false)
    expect(hasPinnedPlayerLimitReached([...managedPins(20), primaryPlayer], 42, 999)).toBe(true)
    expect(hasPinnedPlayerLimitReached([...managedPins(20), primaryPlayer], 42, 100)).toBe(false)
  })
})
