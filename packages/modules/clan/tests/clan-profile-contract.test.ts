import { describe, expect, test } from 'bun:test'
import { toClanProfileContract } from '../api/clan-profile-contract'
import type { ClanProfile } from '../domain/clan-profile'

const storedClan: ClanProfile = {
  clanId: 77,
  clanName: 'Stored',
  clanCreateDate: new Date('2026-01-01T00:00:00.000Z'),
  clanXp: '900719925474099312345',
  clanLifetimeXp: '1801439850948198711110',
  notice: '',
  tags: [],
  discordInviteCode: '',
  guildPoints: '0',
  isRecruiting: false,
  profile: {
    checkedAt: new Date('2026-02-01T00:00:00.000Z'),
    checkProvenance: { source: 'v1-guild-stats', outcome: 'success' },
    lastSuccessAt: new Date(0),
    lastSuccessProvenance: { source: 'v1-guild-stats', outcome: 'success' },
  },
  roster: {
    checkedAt: null,
    checkProvenance: { source: 'v1-guild-members', outcome: 'ambiguous-failure' },
    lastSuccessAt: null,
    lastSuccessProvenance: null,
  },
  members: [],
}

describe('toClanProfileContract', () => {
  test('keeps xp as exact strings and maps each section on its own', () => {
    const contract = toClanProfileContract(storedClan)

    expect(contract).toMatchObject({
      clanId: 77,
      clanCreateDate: '2026-01-01T00:00:00.000Z',
      clanXp: '900719925474099312345',
      clanLifetimeXp: '1801439850948198711110',
      profile: { checkedAt: '2026-02-01T00:00:00.000Z', lastSuccessAt: '1970-01-01T00:00:00.000Z' },
      roster: { checkedAt: null, lastSuccessAt: null, lastSuccessProvenance: null },
    })
  })

  test('leaves the import evidence out of the public provenance', () => {
    const importedClan: ClanProfile = {
      ...storedClan,
      profile: {
        ...storedClan.profile,
        checkProvenance: {
          source: 'legacy-import',
          outcome: 'legacy-unknown',
          legacyTimestamp: '2025-06-01T00:00:00.000Z',
          sourceTable: 'clan',
          sourceKey: '77',
          archiveChecksum: 'a'.repeat(64),
        },
      },
      roster: {
        checkedAt: null,
        checkProvenance: {
          source: 'legacy-import',
          outcome: 'legacy-unknown',
          sourceTables: ['clan_member', 'player_clan'],
          archiveChecksums: ['b'.repeat(64)],
        },
        lastSuccessAt: null,
        lastSuccessProvenance: null,
      },
    }

    const contract = toClanProfileContract(importedClan)

    expect(contract.profile.checkProvenance).toEqual({
      source: 'legacy-import',
      outcome: 'legacy-unknown',
      legacyTimestamp: '2025-06-01T00:00:00.000Z',
    })

    expect(contract.roster?.checkProvenance).toEqual({ source: 'legacy-import', outcome: 'legacy-unknown' })
  })
})
