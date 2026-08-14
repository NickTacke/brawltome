import { describe, expect, test } from 'bun:test'
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
        totalClanXp="10"
      />,
    )

    expect(html).toContain('Player 404')
    expect(html).toContain('clan rank: Unknown')
    expect(html).toContain('Unavailable')
  })

  test('declares responsive header and search-width classes', () => {
    const html = renderToStaticMarkup(
      <MemberList
        members={[]}
        totalClanXp="0"
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
