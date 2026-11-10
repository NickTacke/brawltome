import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { createDailyVisitorKeys } from '../src/visits/daily-visitor-key'

const dayMs = 86_400_000
const browser = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'

function keysAt(startMs: number) {
  let nowMs = startMs
  const keys = createDailyVisitorKeys({ now: () => nowMs, randomBytes: (size) => randomBytes(size) })

  return { keys, moveTo: (timeMs: number) => (nowMs = timeMs) }
}

describe('daily visitor keys', () => {
  test('the same visitor on the same day gets the same key', () => {
    const { keys, moveTo } = keysAt(Date.UTC(2026, 10, 10, 0, 5))
    const morning = keys.keyFor('198.51.100.20', browser)

    moveTo(Date.UTC(2026, 10, 10, 23, 55))

    expect(keys.keyFor('198.51.100.20', browser)).toEqual(morning)
  })

  test('the same visitor on the next utc day gets a new key', () => {
    const { keys, moveTo } = keysAt(Date.UTC(2026, 10, 10, 23, 55))
    const today = keys.keyFor('198.51.100.20', browser)

    moveTo(Date.UTC(2026, 10, 11, 0, 5))
    const tomorrow = keys.keyFor('198.51.100.20', browser)

    expect(tomorrow.key).not.toBe(today.key)
    expect(today.day).toBe('2026-11-10')
    expect(tomorrow.day).toBe('2026-11-11')
  })

  test('a day revisited later never gets its old key back, the secret is gone', () => {
    const { keys, moveTo } = keysAt(Date.UTC(2026, 10, 10, 12))
    const first = keys.keyFor('198.51.100.20', browser)

    moveTo(Date.UTC(2026, 10, 10, 12) + dayMs)
    keys.keyFor('198.51.100.20', browser)
    moveTo(Date.UTC(2026, 10, 10, 12))

    expect(keys.keyFor('198.51.100.20', browser).key).not.toBe(first.key)
  })

  test('different addresses or browsers get different keys', () => {
    const { keys } = keysAt(Date.UTC(2026, 10, 10, 12))
    const visitor = keys.keyFor('198.51.100.20', browser).key

    expect(keys.keyFor('198.51.100.21', browser).key).not.toBe(visitor)
    expect(keys.keyFor('198.51.100.20', `${browser} Edg/131.0`).key).not.toBe(visitor)
  })

  test('an ipv6 visitor keeps one key while their device rotates its temporary address', () => {
    const { keys } = keysAt(Date.UTC(2026, 10, 10, 12))
    const before = keys.keyFor('2001:db8:abcd:12:a1b2:c3d4:e5f6:1', browser).key

    expect(keys.keyFor('2001:db8:abcd:12:9f8e:7d6c:5b4a:2', browser).key).toBe(before)
    expect(keys.keyFor('2001:db8:abcd:13:a1b2:c3d4:e5f6:1', browser).key).not.toBe(before)
  })

  test('the key never contains the address', () => {
    const { keys } = keysAt(Date.UTC(2026, 10, 10, 12))
    const { key } = keys.keyFor('198.51.100.20', browser)

    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(key).not.toContain('198')
  })

  test('two processes never share a key, each draws its own secret', () => {
    const startMs = Date.UTC(2026, 10, 10, 12)

    expect(keysAt(startMs).keys.keyFor('198.51.100.20', browser).key).not.toBe(
      keysAt(startMs).keys.keyFor('198.51.100.20', browser).key,
    )
  })
})
