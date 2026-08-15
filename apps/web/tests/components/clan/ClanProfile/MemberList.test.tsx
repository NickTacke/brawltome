import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemberList } from '../../../../src/components/clan/ClanProfile/MemberList'
import { MemberRow } from '../../../../src/components/clan/ClanProfile/MemberRow'

describe('MemberList', () => {
  test('renders presentation fallbacks for unavailable member metadata', () => {
    const html = renderToStaticMarkup(
      <MemberRow
        member={{
          brawlhallaId: 404,
          name: null,
          rank: null,
          joinDate: null,
          xp: '5',
          guildPoints: null,
        }}
        totalClanLifetimeXp="10"
      />,
    )

    expect(html).toContain('Player 404')
    expect(html).toContain('clan rank: Unknown')
    expect(html).toContain('Unavailable')
  })

  test('uses lifetime clan XP for member contribution', async () => {
    mock.module('@/app/clan/[id]/actions', () => ({
      getClanAction: async () => null,
      refreshClanAction: async () => ({ clan: null, refresh: { outcome: 'notNeeded', retry: { kind: 'none' } } }),
    }))
    mock.module('@/components/NavBar', () => ({ NavBar: () => null }))
    mock.module('@/components/TurnstileGate', () => ({ TurnstileGate: () => null }))
    const { ClanProfile } = await import('../../../../src/components/clan/ClanProfile')
    const provenance = { source: 'v1-guild-stats', outcome: 'success' } as const
    const html = renderToStaticMarkup(
      <ClanProfile
        id="1524690"
        initialData={{
          clanId: 1524690,
          clanName: 'Regression Clan',
          clanCreateDate: '2026-01-01T00:00:00.000Z',
          clanXp: '102106',
          clanLifetimeXp: '994525',
          notice: null,
          tags: null,
          discordInviteCode: null,
          guildPoints: null,
          isRecruiting: null,
          profile: {
            checkedAt: null,
            checkProvenance: provenance,
            lastSuccessAt: null,
            lastSuccessProvenance: null,
          },
          roster: null,
          members: [
            {
              brawlhallaId: 42,
              name: 'Contributor',
              rank: 'Member',
              joinDate: null,
              xp: '318771',
              guildPoints: null,
            },
          ],
        }}
      />,
    )

    expect(html).toContain('XP / Lifetime Contribution')
    expect(html).toContain('32.1%')
    expect(html).not.toContain('312.2%')
  })

  test('declares responsive header and search-width classes', () => {
    const html = renderToStaticMarkup(
      <MemberList
        members={[]}
        totalClanLifetimeXp="0"
        roster={null}
        page={1}
        pageSize={20}
        onPageChange={() => {}}
        searchTerm=""
        onSearchChange={() => {}}
        sortBy="default"
        onSortChange={() => {}}
      />,
    )

    expect(html).toContain('flex flex-col items-stretch')
    expect(html).toContain('sm:flex-row sm:items-center')
    expect(html).toContain('w-full flex-col gap-3 sm:w-auto')
    expect(html).toContain('relative w-full sm:w-64')
  })
})
