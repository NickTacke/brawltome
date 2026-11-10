import { describe, expect, test } from 'bun:test'
import type { LeaderboardEntry } from '@brawltome/contracts'
import { createMemoryHistory, createRouter, RouterContextProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LeaderboardBoard } from '../src/components/leaderboard/LeaderboardBoard'
import type { RankedPage } from '../src/components/ranked-page'
import { routeTree } from '../src/routeTree.gen'
import { leaderboardBody } from './ranking-fixtures'

// links need a router to build their addresses
function renderInRouter(element: ReactNode): string {
  const router = createRouter({ routeTree, history: createMemoryHistory() })

  return renderToStaticMarkup(<RouterContextProvider router={router}>{element}</RouterContextProvider>)
}

function renderBoard(board: RankedPage<LeaderboardEntry> | null, page = 1): string {
  return renderInRouter(
    <LeaderboardBoard board={board} page={page} filters={null} isLoading={false} avatarCount={1} onPage={() => {}} />,
  )
}

function boardPage(page: number, entryCount: number, totalRows: number): RankedPage<LeaderboardEntry> {
  const body = leaderboardBody({ page, entryCount, totalRows })

  return { entries: body.entries as LeaderboardEntry[], totalRows, pageSize: 30 }
}

describe('leaderboard page', () => {
  test('shows thirty players linked to their pages, with a pager', () => {
    const html = renderBoard(boardPage(2, 30, 200), 2)

    expect(html.match(/href="\/player\/\d+"/g)).toHaveLength(30)
    expect(html).toContain('href="/player/31"')
    expect(html).toContain('31–60 of 200')
  })

  test('a failed read says so, without a pager', () => {
    const html = renderBoard(null)

    expect(html).toContain('The leaderboard couldn&#x27;t be loaded')
    expect(html).not.toContain('Next page')
  })

  test('an empty board says so, without a pager', () => {
    const html = renderBoard(boardPage(1, 0, 0))

    expect(html).toContain('Nobody on this board yet')
    expect(html).not.toContain('Next page')
  })

  test('a page past the end says so, and keeps the pager to go back', () => {
    const html = renderBoard(boardPage(9, 0, 200), 9)

    expect(html).toContain('Page 9 is past the end of this board')
    expect(html).toContain('0–0 of 200')
  })
})
