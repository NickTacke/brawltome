import { describe, expect, mock, test } from 'bun:test'
import type { RailAccount, RailPlayer } from '../src/components/rail/rail-account'
import { createRailAccountStore } from '../src/components/rail/rail-account-store'

const player = (brawlhallaId: number): RailPlayer => ({ brawlhallaId, name: `P${brawlhallaId}`, legendNameKey: null })

function signedIn(pinIds: number[], verifiedId: number | null = null): RailAccount {
  return {
    kind: 'signedIn',
    displayName: 'Ada',
    avatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
    verifiedPlayer: verifiedId === null ? null : player(verifiedId),
    pins: pinIds.map(player),
    pinLimit: 20,
  }
}

function pinIdsOf(account: RailAccount): number[] {
  return account.kind === 'signedIn' ? account.pins.map(({ brawlhallaId }) => brawlhallaId) : []
}

// a read the test answers by hand, to control the order reads finish in
function deferredRead() {
  const answers: ((account: RailAccount) => void)[] = []
  const read = mock(() => new Promise<RailAccount>((resolve) => answers.push(resolve)))

  return { read, answer: (index: number, account: RailAccount) => answers[index]?.(account) }
}

describe('the rail account store', () => {
  test('starts signed out, so the first render matches the server html', () => {
    const store = createRailAccountStore(async () => signedIn([1]))

    expect(store.current()).toEqual({ kind: 'signedOut' })
  })

  test('reads the account once however often it is asked to load', async () => {
    const read = mock(async () => signedIn([1, 2]))
    const store = createRailAccountStore(read)

    await Promise.all([store.loadOnce(), store.loadOnce()])
    await store.loadOnce()

    expect(read).toHaveBeenCalledTimes(1)
    expect(pinIdsOf(store.current())).toEqual([1, 2])
  })

  test('tells subscribers when the account changes', async () => {
    const store = createRailAccountStore(async () => signedIn([1]))
    const listener = mock(() => undefined)

    store.subscribe(listener)
    await store.loadOnce()

    expect(listener).toHaveBeenCalled()
  })

  test('stays signed out when the first read fails', async () => {
    const store = createRailAccountStore(async () => {
      throw new Error('load rail account: the account could not be read')
    })

    await store.loadOnce()

    expect(store.current()).toEqual({ kind: 'signedOut' })
  })

  test('keeps what it shows when a later read fails', async () => {
    let shouldFail = false

    const store = createRailAccountStore(async () => {
      if (shouldFail) throw new Error('down')

      return signedIn([1])
    })

    await store.loadOnce()
    shouldFail = true
    await store.reload()

    expect(pinIdsOf(store.current())).toEqual([1])
  })

  test('drops an unpinned player without reading again', async () => {
    const read = mock(async () => signedIn([1, 2, 3], 9))
    const store = createRailAccountStore(read)

    await store.loadOnce()
    await store.applyPinOrder([1, 9, 3])

    expect(read).toHaveBeenCalledTimes(1)
    expect(pinIdsOf(store.current())).toEqual([1, 3])
  })

  test('follows a new order without reading again', async () => {
    const read = mock(async () => signedIn([1, 2, 3]))
    const store = createRailAccountStore(read)

    await store.loadOnce()
    await store.applyPinOrder([3, 1, 2])

    expect(read).toHaveBeenCalledTimes(1)
    expect(pinIdsOf(store.current())).toEqual([3, 1, 2])
  })

  test('reads again for a newly pinned player, whose name and legend it lacks', async () => {
    let pinIds = [1]
    const store = createRailAccountStore(async () => signedIn(pinIds))

    await store.loadOnce()
    pinIds = [1, 4]
    await store.applyPinOrder([1, 4])

    expect(pinIdsOf(store.current())).toEqual([1, 4])
  })

  test('shows signed out after sign out, even when a read lands later', async () => {
    const { read, answer } = deferredRead()
    const store = createRailAccountStore(read)
    const loading = store.loadOnce()

    store.showSignedOut()
    answer(0, signedIn([1]))
    await loading

    expect(store.current()).toEqual({ kind: 'signedOut' })
  })

  test('ignores a read that finishes after a newer one', async () => {
    const { read, answer } = deferredRead()
    const store = createRailAccountStore(read)
    const older = store.loadOnce()
    const newer = store.reload()

    answer(1, signedIn([2]))
    await newer
    answer(0, signedIn([1]))
    await older

    expect(pinIdsOf(store.current())).toEqual([2])
  })

  test('follows a saved pin write', async () => {
    const read = mock(async () => signedIn([1, 2]))
    const store = createRailAccountStore(read)

    await store.loadOnce()
    await store.followPinWrite({ kind: 'saved', pinOrder: [2] })

    expect(pinIdsOf(store.current())).toEqual([2])
  })

  test('shows signed out when a pin write finds no session', async () => {
    const store = createRailAccountStore(async () => signedIn([1]))

    await store.loadOnce()
    await store.followPinWrite({ kind: 'signedOut' })

    expect(store.current()).toEqual({ kind: 'signedOut' })
  })

  // a pin can fail because another tab filled the pins, and a fresh count lets the button say so
  test('reads again after a failed pin write', async () => {
    const read = mock(async () => signedIn([1]))
    const store = createRailAccountStore(read)

    await store.loadOnce()
    await store.followPinWrite({ kind: 'failed' })

    expect(read).toHaveBeenCalledTimes(2)
  })

  test('reads again when the account page shows a verified account the rail does not have yet', async () => {
    const read = mock(async () => signedIn([1]))
    const store = createRailAccountStore(read)

    await store.loadOnce()
    read.mockImplementation(async () => signedIn([1], 7))
    await store.followVerification(7)

    expect(store.current()).toEqual(signedIn([1], 7))
  })

  test('leaves the rail alone when it already shows the same verified account', async () => {
    const read = mock(async () => signedIn([1], 7))
    const store = createRailAccountStore(read)

    await store.loadOnce()
    await store.followVerification(7)

    expect(read).toHaveBeenCalledTimes(1)
  })

  test('a signed out rail does not read for a verification', async () => {
    const read = mock(async () => signedIn([1], 7))
    const store = createRailAccountStore(read)

    await store.followVerification(7)

    expect(read).not.toHaveBeenCalled()
  })
})
