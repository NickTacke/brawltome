import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemberList } from '../../../../src/components/clan/ClanProfile/MemberList'

describe('MemberList', () => {
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
