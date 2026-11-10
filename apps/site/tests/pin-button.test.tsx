import { describe, expect, mock, test } from 'bun:test'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PinWriteAnswer } from '../src/components/account/account-model'
import { NameDetails } from '../src/components/player/Identity'
import { PinButtonView } from '../src/components/player/PinButton'
import { togglePin } from '../src/components/player/pin-toggle'
import type { RailAccount, RailPlayer } from '../src/components/rail/rail-account'
import { createRailAccountStore } from '../src/components/rail/rail-account-store'

const player = (brawlhallaId: number): RailPlayer => ({ brawlhallaId, name: `P${brawlhallaId}`, legendNameKey: null })

function signedIn(pinIds: number[], pinLimit = 20): RailAccount {
  return {
    kind: 'signedIn',
    displayName: 'Ada',
    avatarUrl: null,
    verifiedPlayer: player(7),
    pins: pinIds.map(player),
    pinLimit,
  }
}

async function render(element: ReactNode): Promise<string> {
  const rootRoute = createRootRoute({ component: () => element })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/player/9'] }) })

  await router.load()

  return renderToStaticMarkup(<RouterProvider router={router} />)
}

const idle = { isBusy: false, hasFailed: false, onToggle: () => undefined }

function renderButton(account: RailAccount, playerId = 9) {
  return render(<PinButtonView account={account} playerId={playerId} {...idle} />)
}

describe('the pin button', () => {
  test('leads a signed out visitor to sign in', async () => {
    const html = await renderButton({ kind: 'signedOut' })

    expect(html).toMatch(/<a[^>]*href="\/account"[^>]*>Pin/)
    expect(html).not.toContain('<button')
  })

  test('pins a player who is not pinned yet', async () => {
    const html = await renderButton(signedIn([8]))

    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Pin</)
  })

  test('says pinned, with a filled icon, and unpins on a second press', async () => {
    const html = await renderButton(signedIn([8, 9]))

    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Pinned</)
    expect(html).toContain('fill="currentColor"')
  })

  test('says plainly when the pins are full', async () => {
    const html = await renderButton(signedIn([1, 2], 2))

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Pin limit reached</)
  })

  test('still unpins a pinned player when the pins are full', async () => {
    const html = await renderButton(signedIn([1, 9], 2))

    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>Pinned</)
  })

  test("is left out on the visitor's own verified account", async () => {
    expect(await renderButton(signedIn([8]), 7)).toBe('')
  })
})

describe('the row under the player name', () => {
  test('holds the pin button even without aliases or a region', async () => {
    const html = await render(<NameDetails aliases={[]} region={null} playerId={9} />)

    expect(html).toContain('>Pin')
  })
})

describe('togglePin', () => {
  // a fake api: the pins it holds, and the rail read built from them
  function fakeAccount(initialPins: number[]) {
    let pins = [...initialPins]
    const store = createRailAccountStore(async () => signedIn(pins))

    const pin = mock(async (id: number): Promise<PinWriteAnswer> => {
      pins = [...pins, id]

      return { kind: 'saved', pinOrder: pins }
    })

    const unpin = mock(async (id: number): Promise<PinWriteAnswer> => {
      pins = pins.filter((pinned) => pinned !== id)

      return { kind: 'saved', pinOrder: pins }
    })

    return { store, writes: { pin, unpin } }
  }

  function pinIdsOf(account: RailAccount): number[] {
    return account.kind === 'signedIn' ? account.pins.map(({ brawlhallaId }) => brawlhallaId) : []
  }

  test('pins a player and the rail shows it', async () => {
    const { store, writes } = fakeAccount([8])

    await store.loadOnce()
    await togglePin(store, writes, 9)

    expect(writes.pin).toHaveBeenCalledWith(9)
    expect(pinIdsOf(store.current())).toEqual([8, 9])
  })

  test('unpins a pinned player and the rail drops it', async () => {
    const { store, writes } = fakeAccount([8, 9])

    await store.loadOnce()
    await togglePin(store, writes, 9)

    expect(writes.unpin).toHaveBeenCalledWith(9)
    expect(pinIdsOf(store.current())).toEqual([8])
  })

  test('answers failed when the write throws', async () => {
    const { store } = fakeAccount([8])

    const throwing = async (): Promise<PinWriteAnswer> => {
      throw new Error('network')
    }

    await store.loadOnce()

    expect(await togglePin(store, { pin: throwing, unpin: throwing }, 9)).toEqual({ kind: 'failed' })
  })
})
