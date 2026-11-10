import { describe, expect, test } from 'bun:test'
import { accountPinnedPlayersSchema, accountSessionSchema, accountSignOutSchema } from '../src'

const account = {
  id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
  displayName: 'Ada',
  avatarUrl: null,
  createdAt: '2026-08-09T18:42:01.000Z',
}

describe('account session', () => {
  test('answers anonymous for a visitor without a valid session', () => {
    expect(accountSessionSchema.parse({ status: 'anonymous' })).toEqual({ status: 'anonymous' })
  })

  test('answers the account and when a renewed session now ends', () => {
    const renewed = { status: 'signedIn' as const, account, sessionRenewedUntil: '2026-09-08T18:42:01.000Z' }
    const notRenewed = { status: 'signedIn' as const, account, sessionRenewedUntil: null }

    expect(accountSessionSchema.parse(renewed)).toEqual(renewed)
    expect(accountSessionSchema.parse(notRenewed)).toEqual(notRenewed)
  })

  test('never carries a session token', () => {
    const withToken = { status: 'signedIn', account, sessionRenewedUntil: null, sessionToken: 'raw' }

    expect(accountSessionSchema.safeParse(withToken).success).toBe(false)
  })
})

describe('account pinned players', () => {
  test('lists bookmarks in their order', () => {
    const pins = [
      { brawlhallaId: 7, order: 0, pinnedAt: '2026-08-09T18:42:01.000Z' },
      { brawlhallaId: 9, order: 1, pinnedAt: '2026-08-10T18:42:01.000Z' },
    ]

    expect(accountPinnedPlayersSchema.parse(pins)).toEqual(pins)
  })

  test('refuses ids outside the player id range and unknown fields', () => {
    const pinnedAt = '2026-08-09T18:42:01.000Z'

    expect(accountPinnedPlayersSchema.safeParse([{ brawlhallaId: 0, order: 0, pinnedAt }]).success).toBe(false)
    expect(accountPinnedPlayersSchema.safeParse([{ brawlhallaId: 7, order: 0, pinnedAt, x: 1 }]).success).toBe(false)
  })
})

describe('account sign out', () => {
  test('answers that the session is gone', () => {
    expect(accountSignOutSchema.parse({ status: 'signedOut' })).toEqual({ status: 'signedOut' })
  })
})
