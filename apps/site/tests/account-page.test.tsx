import { describe, expect, test } from 'bun:test'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AccountPage, PinnedPlayerRow, Verification } from '../src/components/account/account-model'
import { SignedInPage } from '../src/components/account/SignedInPage'
import { SignedOutPanel } from '../src/components/account/SignedOutPanel'

const signInUrl = 'https://api.brawltome.app/auth/discord/login'
const verifySteamUrl = 'https://api.brawltome.app/auth/steam/link'

function row(brawlhallaId: number, name: string): PinnedPlayerRow {
  return {
    brawlhallaId,
    name,
    legendNameKey: 'bodvar',
    region: 'EU',
    tier: 'Diamond',
    rating: 2010,
    peakRating: 2100,
    wins: 12,
    games: 20,
  }
}

type SignedIn = Extract<AccountPage, { kind: 'signedIn' }>

function signedInPage(verification: Verification, pins = [row(8, 'Eight'), row(9, 'Nine')]): SignedIn {
  return {
    kind: 'signedIn',
    account: { displayName: 'Ada', avatarUrl: null, createdAt: '2025-03-12T10:00:00.000Z' },
    verification,
    pins,
    pinOrder: pins.map(({ brawlhallaId }) => brawlhallaId),
    verifySteamUrl,
  }
}

// the page uses the router for links and reloads, so it renders inside a small one
async function renderInRouter(element: ReactNode): Promise<string> {
  const rootRoute = createRootRoute({ component: () => element })
  const history = createMemoryHistory({ initialEntries: ['/account'] })
  const router = createRouter({ routeTree: rootRoute, history })

  await router.load()

  return renderToStaticMarkup(<RouterProvider router={router} />)
}

function renderSignedIn(verification: Verification, pins?: PinnedPlayerRow[], errorMessage: string | null = null) {
  return renderInRouter(<SignedInPage page={signedInPage(verification, pins)} errorMessage={errorMessage} />)
}

function buttonFor(html: string, label: string): string {
  return html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? ''
}

describe('signed out', () => {
  test('offers discord sign-in through the api', () => {
    const html = renderToStaticMarkup(<SignedOutPanel signInUrl={signInUrl} errorMessage={null} />)

    expect(html).toContain('Sign in to BrawlTome')
    expect(html).toContain(`href="${signInUrl}"`)
    expect(html).toContain('Continue with Discord')
    expect(html).not.toContain('role="alert"')
  })

  test('says why the last sign-in failed', () => {
    const html = renderToStaticMarkup(<SignedOutPanel signInUrl={signInUrl} errorMessage="Please try again." />)

    expect(html).toContain('role="alert"')
    expect(html).toContain('Please try again.')
  })
})

describe('signed in', () => {
  test('shows the discord name, the member-since date and sign out', async () => {
    const html = await renderSignedIn({ status: 'unverified' })

    expect(html).toContain('Ada')
    expect(html).toContain('Member since 12 Mar 2025')
    expect(html).toContain('Sign out</button>')
  })

  test('puts the verified account first, without actions', async () => {
    const html = await renderSignedIn({ status: 'verified', player: row(7, 'Seven') })

    expect(html.indexOf('Seven')).toBeLessThan(html.indexOf('Eight'))
    expect(html).toContain('Your account</span>')
    expect(buttonFor(html, 'Unpin Seven')).toBe('')
    expect(buttonFor(html, 'Unpin Eight')).not.toBe('')
    expect(html).toContain('<span class="font-black text-strong">3</span> pinned')
  })

  test('lets a pin move only where it can go', async () => {
    const html = await renderSignedIn({ status: 'verified', player: row(7, 'Seven') })

    expect(buttonFor(html, 'Move Eight up')).toContain('disabled=""')
    expect(buttonFor(html, 'Move Eight down')).not.toContain('disabled=""')
    expect(buttonFor(html, 'Move Nine up')).not.toContain('disabled=""')
    expect(buttonFor(html, 'Move Nine down')).toContain('disabled=""')
  })

  test('says when nothing is pinned', async () => {
    expect(await renderSignedIn({ status: 'unverified' }, [])).toContain('No pinned players yet.')
  })

  test('names a player the site has never stored by id', async () => {
    expect(await renderSignedIn({ status: 'unverified' }, [{ ...row(5, 'x'), name: null }])).toContain('Player 5')
  })

  test('shows the theme picker', async () => {
    expect(await renderSignedIn({ status: 'unverified' })).toContain('New theme')
  })
})

describe('your account', () => {
  test('shows the verified player', async () => {
    const html = await renderSignedIn({ status: 'verified', player: row(7, 'Seven') })

    expect(html).toContain('Verified through Steam')
    expect(html).not.toContain(verifySteamUrl)
  })

  test('offers steam verification through the api when unverified', async () => {
    const html = await renderSignedIn({ status: 'unverified' })

    expect(html).toContain(`href="${verifySteamUrl}"`)
    expect(html).toContain('Verify with Steam')
  })

  test('says a check is running while pending, with nothing to click', async () => {
    const html = await renderSignedIn({ status: 'pending' })

    expect(html).toContain('Verifying your account…')
    expect(html).not.toContain(verifySteamUrl)
  })

  test.each([
    ['failed', 'Steam found no Brawlhalla account'],
    ['conflict', 'Another BrawlTome account already verified'],
  ] as const)('explains a %s check and offers another try', async (status, text) => {
    const html = await renderSignedIn({ status })

    expect(html).toContain(text)
    expect(html).toContain(`href="${verifySteamUrl}"`)
    expect(html).toContain('Try again</a>')
  })

  test('says why the last steam check failed', async () => {
    const html = await renderSignedIn({ status: 'unverified' }, undefined, "Steam couldn't confirm your account.")

    expect(html).toContain('role="alert"')
    expect(html).toContain('Steam couldn&#x27;t confirm your account.')
  })
})
