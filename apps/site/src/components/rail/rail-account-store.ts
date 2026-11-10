import type { PinWriteAnswer } from '../account/account-model'
import { orderRows } from '../account/pin-order'
import { type RailAccount, type SignedInRail, signedOutRail } from './rail-account'

type ReadRailAccount = () => Promise<RailAccount>

function knowsEveryPin(rail: SignedInRail, pinOrder: number[]): boolean {
  const knownIds = new Set(rail.pins.map(({ brawlhallaId }) => brawlhallaId))

  if (rail.verifiedPlayer) knownIds.add(rail.verifiedPlayer.brawlhallaId)

  return pinOrder.every((brawlhallaId) => knownIds.has(brawlhallaId))
}

/**
 * The visitor's account as the rail, the mobile menu and the pin button show it. It starts signed out, the same as the
 * server html, and a failed read keeps whatever it shows, so a visitor never sees an error for it.
 */
export function createRailAccountStore(read: ReadRailAccount) {
  let account: RailAccount = signedOutRail
  let firstLoad: Promise<void> | null = null
  // only the latest read or sign out may change the account, so an older read landing late can't undo it
  let latestChange = 0
  const listeners = new Set<() => void>()

  function show(next: RailAccount) {
    account = next

    for (const listener of listeners) listener()
  }

  async function reload() {
    latestChange += 1

    const change = latestChange
    const next = await read().catch(() => null)

    if (next && change === latestChange) show(next)
  }

  function showSignedOut() {
    latestChange += 1
    show(signedOutRail)
  }

  /** Follows the order a pin write answered, and reads again only for a player the rail can't show yet. */
  async function applyPinOrder(pinOrder: number[]) {
    if (account.kind !== 'signedIn' || !knowsEveryPin(account, pinOrder)) return reload()

    latestChange += 1
    show({ ...account, pins: orderRows(account.pins, pinOrder) })
  }

  /** Brings the rail in line with a pin write from the account page or the player page. */
  async function followPinWrite(answer: PinWriteAnswer) {
    if (answer.kind === 'signedOut') return showSignedOut()

    if (answer.kind === 'failed') return reload()

    return applyPinOrder(answer.pinOrder)
  }

  /** Reads again when the account page shows a verified account the rail doesn't, e.g. a verification that just finished. */
  async function followVerification(verifiedId: number | null) {
    if (account.kind !== 'signedIn') return

    const railVerifiedId = account.verifiedPlayer?.brawlhallaId ?? null

    if (railVerifiedId === verifiedId) return

    return reload()
  }

  return {
    current: () => account,
    subscribe(listener: () => void) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    loadOnce() {
      firstLoad ??= reload()

      return firstLoad
    },
    reload,
    showSignedOut,
    applyPinOrder,
    followPinWrite,
    followVerification,
  }
}

export type RailAccountStore = ReturnType<typeof createRailAccountStore>
