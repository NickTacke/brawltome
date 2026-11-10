import { describe, expect, test } from 'bun:test'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MenuAccount } from '../src/components/MobileMenu'
import { RailAccountLink } from '../src/components/rail/RailAccountLink'
import { MenuPlayers, RailPlayers } from '../src/components/rail/RailPlayers'
import type { RailAccount, RailPlayer } from '../src/components/rail/rail-account'

const avatarUrl = 'https://cdn.discordapp.com/avatars/1/a.png'

const player = (brawlhallaId: number, name: string | null): RailPlayer => ({
  brawlhallaId,
  name,
  legendNameKey: 'bodvar',
})

const signedIn: RailAccount = {
  kind: 'signedIn',
  displayName: 'Ada',
  avatarUrl,
  verifiedPlayer: player(7, 'Seven'),
  pins: [player(9, 'Nine'), player(8, null)],
  pinLimit: 20,
}

// links need a router to render
async function render(element: ReactNode): Promise<string> {
  const rootRoute = createRootRoute({ component: () => element })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })

  await router.load()

  return renderToStaticMarkup(<RouterProvider router={router} />)
}

function linkTargets(html: string): string[] {
  return [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((match) => match[1] ?? '')
}

describe('the account link at the bottom of the rail', () => {
  test('is the sign-in icon when signed out', async () => {
    const html = await render(<RailAccountLink account={{ kind: 'signedOut' }} />)

    expect(html).toContain('aria-label="Sign in"')
    expect(html).not.toContain('<img')
  })

  test('is the discord avatar with the name in a tooltip when signed in', async () => {
    const html = await render(<RailAccountLink account={signedIn} />)

    expect(html).toContain('aria-label="Account"')
    expect(html).toContain(`src="${avatarUrl}"`)
    expect(html).toContain('>Ada</span>')
    expect(linkTargets(html)).toEqual(['/account'])
  })
})

describe('the pinned players in the rail', () => {
  test('lead with the verified account, then the pins in their order', async () => {
    const html = await render(<RailPlayers account={signedIn} />)

    expect(linkTargets(html)).toEqual(['/player/7', '/player/9', '/player/8'])
    expect(html).toContain('aria-label="Your account, Seven"')
    expect(html).toContain('aria-label="Pinned player, Nine"')
  })

  test('name each player in a tooltip, or the id when the name is unknown', async () => {
    const html = await render(<RailPlayers account={signedIn} />)

    expect(html).toContain('>Seven</span>')
    expect(html).toContain('>Player 8</span>')
  })

  test('show nothing when signed out', async () => {
    expect(linkTargets(await render(<RailPlayers account={{ kind: 'signedOut' }} />))).toEqual([])
  })
})

describe('the mobile menu', () => {
  test('lists the same players in the same order', async () => {
    const html = await render(<MenuPlayers account={signedIn} onClose={() => undefined} />)

    expect(linkTargets(html)).toEqual(['/player/7', '/player/9', '/player/8'])
  })

  test('shows the avatar and name when signed in', async () => {
    const html = await render(<MenuAccount account={signedIn} onClose={() => undefined} />)

    expect(html).toContain(`src="${avatarUrl}"`)
    expect(html).toContain('Ada')
  })

  test('offers sign in when signed out', async () => {
    const html = await render(<MenuAccount account={{ kind: 'signedOut' }} onClose={() => undefined} />)

    expect(html).toContain('Sign in')
    expect(html).not.toContain('<img')
  })
})
