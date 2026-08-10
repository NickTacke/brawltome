import { describe, expect, test } from 'bun:test'
import { pollClanUntilSectionsComplete } from '../../src/commands/clan'
import type { ClanResponse } from '../../src/lib/types'

function clan(profileSuccess: string | null, rosterSuccess: string | null): ClanResponse {
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
      checkProvenance: { source: 'v1-guild-stats', outcome: 'success' },
      lastSuccessAt: profileSuccess,
      lastSuccessProvenance: profileSuccess ? { source: 'v1-guild-stats', outcome: 'success' } : null,
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

describe('Discord clan refresh polling', () => {
  test('keeps polling until every initially stale section advances', async () => {
    const initial = clan(null, null)
    const responses = [
      clan('2026-01-01T01:00:00.000Z', null),
      clan('2026-01-01T01:00:00.000Z', '2026-01-01T01:00:00.000Z'),
    ]
    let queries = 0
    const result = await pollClanUntilSectionsComplete(
      initial,
      2,
      async () => responses[queries++] ?? responses.at(-1) ?? null,
      async () => {},
    )
    expect(queries).toBe(2)
    expect(result?.roster?.lastSuccessAt).toBe('2026-01-01T01:00:00.000Z')
  })

  test('stops at the bounded poll limit when a section remains unavailable', async () => {
    let queries = 0
    await pollClanUntilSectionsComplete(
      null,
      2,
      async () => {
        queries++
        return clan('2026-01-01T01:00:00.000Z', null)
      },
      async () => {},
      3,
    )
    expect(queries).toBe(3)
  })
})
