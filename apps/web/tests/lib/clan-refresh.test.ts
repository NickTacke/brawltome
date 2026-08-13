import { describe, expect, test } from 'bun:test'
import type { ClanProfileContract } from '@brawltome/contracts'
import { getPendingClanSections, hasCompletedClanRefresh } from '../../src/lib/clan-refresh'

function clan(profileSuccess: string | null, rosterSuccess: string | null): ClanProfileContract {
  const provenance = { source: 'v1-guild-stats', outcome: 'success' } as const
  return {
    clanId: 77,
    clanName: 'Clan',
    clanCreateDate: '2026-01-01T00:00:00.000Z',
    clanXp: '1',
    clanLifetimeXp: '2',
    notice: null,
    tags: null,
    discordInviteCode: null,
    guildPoints: null,
    isRecruiting: null,
    profile: {
      checkedAt: profileSuccess,
      checkProvenance: provenance,
      lastSuccessAt: profileSuccess,
      lastSuccessProvenance: profileSuccess ? provenance : null,
    },
    roster: {
      checkedAt: rosterSuccess,
      checkProvenance: { source: 'v1-guild-members', outcome: 'success' },
      lastSuccessAt: rosterSuccess,
      lastSuccessProvenance: rosterSuccess ? { source: 'v1-guild-members', outcome: 'success' } : null,
    },
    members: [],
  }
}

describe('clan refresh sections', () => {
  test('identifies stale sections independently', () => {
    const now = Date.UTC(2026, 0, 1, 2)
    expect(getPendingClanSections(clan('2026-01-01T01:30:00.000Z', '2026-01-01T00:00:00.000Z'), now)).toEqual({
      profile: false,
      roster: true,
    })
  })

  test('waits for every section that was pending at request start', () => {
    const initial = clan('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    const pending = { profile: true, roster: true }
    expect(
      hasCompletedClanRefresh(initial, clan('2026-01-01T02:00:00.000Z', '2026-01-01T00:00:00.000Z'), pending),
    ).toBe(false)
    expect(
      hasCompletedClanRefresh(initial, clan('2026-01-01T02:00:00.000Z', '2026-01-01T02:00:00.000Z'), pending),
    ).toBe(true)
  })
})
