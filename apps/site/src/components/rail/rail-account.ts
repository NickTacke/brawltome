import type { PinnedPlayerRow, SignedInAccount, Verification } from '../account/account-model'

/** A player in the rail: enough for a shortcut with the legend avatar and the name in a tooltip. */
export type RailPlayer = {
  brawlhallaId: number
  name: string | null
  legendNameKey: string | null
}

export type RailAccount =
  | { kind: 'signedOut' }
  | {
      kind: 'signedIn'
      displayName: string
      avatarUrl: string | null
      verifiedPlayer: RailPlayer | null
      // every pin but the verified account, in the stored order
      pins: RailPlayer[]
      // from the server, so the client bundle doesn't take in the contracts for one number
      pinLimit: number
    }

export type SignedInRail = Extract<RailAccount, { kind: 'signedIn' }>

export const signedOutRail: RailAccount = { kind: 'signedOut' }

type SignedInParts = { account: SignedInAccount; verification: Verification; pins: PinnedPlayerRow[] }

function toRailPlayer({ brawlhallaId, name, legendNameKey }: PinnedPlayerRow): RailPlayer {
  return { brawlhallaId, name, legendNameKey }
}

export function toRailAccount({ account, verification, pins }: SignedInParts, pinLimit: number): SignedInRail {
  const verifiedPlayer = verification.status === 'verified' ? toRailPlayer(verification.player) : null

  return {
    kind: 'signedIn',
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    verifiedPlayer,
    pins: pins.map(toRailPlayer),
    pinLimit,
  }
}

/** The players the rail shows: the verified account first, then the other pins in their order. */
export function railPlayers(rail: SignedInRail): RailPlayer[] {
  return rail.verifiedPlayer ? [rail.verifiedPlayer, ...rail.pins] : rail.pins
}

export function isPinned(rail: SignedInRail, brawlhallaId: number): boolean {
  return rail.pins.some((pin) => pin.brawlhallaId === brawlhallaId)
}

// the verified account doesn't count towards the limit, the api leaves it out too
export function isAtPinLimit(rail: SignedInRail): boolean {
  return rail.pins.length >= rail.pinLimit
}
