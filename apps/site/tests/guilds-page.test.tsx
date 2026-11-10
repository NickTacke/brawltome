import { describe, expect, test } from 'bun:test'
import { createMemoryHistory, createRouter, RouterContextProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GuildRanking } from '../src/components/guilds/GuildRanking'
import type { RankedPage } from '../src/components/ranked-page'
import { routeTree } from '../src/routeTree.gen'
import type { RankedGuild } from '../src/server/load-guild-ranking'
import { guildRankingBody } from './ranking-fixtures'

// links need a router to build their addresses
function renderInRouter(element: ReactNode): string {
  const router = createRouter({ routeTree, history: createMemoryHistory() })

  return renderToStaticMarkup(<RouterContextProvider router={router}>{element}</RouterContextProvider>)
}

function renderGuilds(ranking: RankedPage<RankedGuild> | null, page = 1): string {
  return renderInRouter(<GuildRanking ranking={ranking} page={page} onPage={() => {}} />)
}

function guildPage(page: number, entryCount: number, totalRows: number): RankedPage<RankedGuild> {
  return { ...guildRankingBody({ page, entryCount, totalRows }), pageSize: 30 }
}

describe('guilds page', () => {
  test('shows thirty guilds linked to their pages, ranked from where the page starts', () => {
    const html = renderGuilds(guildPage(2, 30, 500), 2)

    expect(html.match(/href="\/guild\/\d+"/g)).toHaveLength(30)
    expect(html).toContain('href="/guild/310"')
    expect(html).toContain('31–60 of 500')
  })

  test('an unranked guild takes its place on the page', () => {
    const ranking = guildPage(2, 1, 31)
    const unranked = { ...ranking, entries: [{ ...ranking.entries[0], rank: null }] } as RankedPage<RankedGuild>

    expect(renderGuilds(unranked, 2)).toMatch(/>31<\/td>/)
  })

  test('a failed read says so, without a pager', () => {
    const html = renderGuilds(null)

    expect(html).toContain('The guild ranking couldn&#x27;t be loaded')
    expect(html).not.toContain('Next page')
  })

  test('no ranked guilds says so, without a pager', () => {
    const html = renderGuilds(guildPage(1, 0, 0))

    expect(html).toContain('No ranked guilds yet')
    expect(html).not.toContain('Next page')
  })

  test('a page past the end says so, and keeps the pager to go back', () => {
    const html = renderGuilds(guildPage(40, 0, 500), 40)

    expect(html).toContain('Page 40 is past the end of the ranking')
    expect(html).toContain('0–0 of 500')
  })
})
