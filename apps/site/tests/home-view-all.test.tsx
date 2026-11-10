import { describe, expect, test } from 'bun:test'
import { createMemoryHistory, createRouter, RouterContextProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TopGuilds } from '../src/components/home/TopGuilds'
import { TopPlayers } from '../src/components/home/TopPlayers'
import { routeTree } from '../src/routeTree.gen'

// no load, so Home's loaders never run
function renderAt(address: string, element: ReactNode): string {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [address] }) })

  return renderToStaticMarkup(<RouterContextProvider router={router}>{element}</RouterContextProvider>)
}

describe("home's view all links", () => {
  test('top players opens the leaderboard on the board picked on Home', () => {
    const element = <TopPlayers entries={[]} filters={null} isLoading={false} avatarCount={1} />
    const html = renderAt('/?mode=2v2&region=EU', element)

    expect(html).toContain('href="/leaderboard?mode=2v2&amp;region=EU"')
  })

  test('top guilds opens the guilds page', () => {
    const html = renderAt('/', <TopGuilds guilds={[]} />)

    expect(html).toContain('href="/guilds"')
  })
})
