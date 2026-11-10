import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { createDailyVisitorKeys } from '../src/visits/daily-visitor-key'

const browser = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'

// stands in for the database: one salt per day, the same for every process that asks
function createSaltStore() {
  const salts = new Map<string, Uint8Array>()
  const readDays: string[] = []

  async function saltFor(day: string): Promise<Uint8Array> {
    readDays.push(day)
    const salt = salts.get(day) ?? randomBytes(32)

    salts.set(day, salt)

    return salt
  }

  return { saltFor, readDays }
}

function keysAt(startMs: number, loadSalt = createSaltStore().saltFor, readTimeoutMs = 1_000) {
  let nowMs = startMs
  const keys = createDailyVisitorKeys({ now: () => nowMs, loadSalt, readTimeoutMs })

  return { keys, moveTo: (timeMs: number) => (nowMs = timeMs) }
}

describe('daily visitor keys', () => {
  test('the same visitor on the same day gets the same key', async () => {
    const { keys, moveTo } = keysAt(Date.UTC(2026, 10, 10, 0, 5))
    const morning = (await keys.forToday()).keyFor('198.51.100.20', browser)

    moveTo(Date.UTC(2026, 10, 10, 23, 55))

    expect((await keys.forToday()).keyFor('198.51.100.20', browser)).toBe(morning)
  })

  test('the same visitor on the next utc day gets a new key', async () => {
    const { keys, moveTo } = keysAt(Date.UTC(2026, 10, 10, 23, 55))
    const today = await keys.forToday()

    moveTo(Date.UTC(2026, 10, 11, 0, 5))
    const tomorrow = await keys.forToday()

    expect(tomorrow.keyFor('198.51.100.20', browser)).not.toBe(today.keyFor('198.51.100.20', browser))
    expect(today.day).toBe('2026-11-10')
    expect(tomorrow.day).toBe('2026-11-11')
  })

  test('a visit id is renamed with the day, so a tab left open overnight cannot be followed', async () => {
    const { keys, moveTo } = keysAt(Date.UTC(2026, 10, 10, 23, 55))
    const visitId = 'b'.repeat(32)
    const lateEvening = (await keys.forToday()).visitKeyFor(visitId)

    expect((await keys.forToday()).visitKeyFor(visitId)).toBe(lateEvening)
    expect(lateEvening).not.toContain(visitId)

    moveTo(Date.UTC(2026, 10, 11, 0, 5))

    expect((await keys.forToday()).visitKeyFor(visitId)).not.toBe(lateEvening)
  })

  test('different addresses or browsers get different keys', async () => {
    const today = await keysAt(Date.UTC(2026, 10, 10, 12)).keys.forToday()
    const visitor = today.keyFor('198.51.100.20', browser)

    expect(today.keyFor('198.51.100.21', browser)).not.toBe(visitor)
    expect(today.keyFor('198.51.100.20', `${browser} Edg/131.0`)).not.toBe(visitor)
  })

  test('an ipv6 visitor keeps one key while their device rotates its temporary address', async () => {
    const today = await keysAt(Date.UTC(2026, 10, 10, 12)).keys.forToday()
    const before = today.keyFor('2001:db8:abcd:12:a1b2:c3d4:e5f6:1', browser)

    expect(today.keyFor('2001:db8:abcd:12:9f8e:7d6c:5b4a:2', browser)).toBe(before)
    expect(today.keyFor('2001:db8:abcd:13:a1b2:c3d4:e5f6:1', browser)).not.toBe(before)
  })

  test('the key never contains the address', async () => {
    const today = await keysAt(Date.UTC(2026, 10, 10, 12)).keys.forToday()
    const key = today.keyFor('198.51.100.20', browser)

    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(key).not.toContain('198.51.100.20')
  })

  test('two processes that share the salt give a visitor the same key', async () => {
    const startMs = Date.UTC(2026, 10, 10, 12)
    const store = createSaltStore()
    const beforeRestart = await keysAt(startMs, store.saltFor).keys.forToday()
    const afterRestart = await keysAt(startMs, store.saltFor).keys.forToday()

    expect(afterRestart.keyFor('198.51.100.20', browser)).toBe(beforeRestart.keyFor('198.51.100.20', browser))
    expect(afterRestart.visitKeyFor('b'.repeat(32))).toBe(beforeRestart.visitKeyFor('b'.repeat(32)))
  })

  test('the salt is read once a day, not once a page view', async () => {
    const store = createSaltStore()
    const { keys, moveTo } = keysAt(Date.UTC(2026, 10, 10, 12), store.saltFor)

    await keys.forToday()
    await keys.forToday()
    moveTo(Date.UTC(2026, 10, 11, 0, 5))
    await keys.forToday()
    await keys.forToday()

    expect(store.readDays).toEqual(['2026-11-10', '2026-11-11'])
  })

  test('page views that arrive together on a new day wait for the same read', async () => {
    const store = createSaltStore()
    const { keys } = keysAt(Date.UTC(2026, 10, 10, 12), store.saltFor)
    const [first, second, third] = await Promise.all([keys.forToday(), keys.forToday(), keys.forToday()])

    expect(store.readDays).toEqual(['2026-11-10'])
    expect(second.keyFor('198.51.100.20', browser)).toBe(first.keyFor('198.51.100.20', browser))
    expect(third.keyFor('198.51.100.20', browser)).toBe(first.keyFor('198.51.100.20', browser))
  })

  test('a failed read is not kept, the next page view asks again', async () => {
    const store = createSaltStore()
    let isDatabaseDown = true

    const loadSalt = (day: string) =>
      isDatabaseDown ? Promise.reject(new Error('connection refused')) : store.saltFor(day)

    const { keys } = keysAt(Date.UTC(2026, 10, 10, 12), loadSalt)

    await expect(keys.forToday()).rejects.toThrow('connection refused')
    await expect(keys.forToday()).rejects.toThrow('connection refused')

    isDatabaseDown = false

    expect((await keys.forToday()).day).toBe('2026-11-10')
    expect(store.readDays).toEqual(['2026-11-10'])
  })

  test('a read of the day before that fails late leaves the new day its keys', async () => {
    const store = createSaltStore()
    let failYesterdaysRead = (_error: Error) => {}

    const yesterdaysRead = new Promise<Uint8Array>((_resolve, reject) => {
      failYesterdaysRead = reject
    })

    const loadSalt = (day: string) => (day === '2026-11-10' ? yesterdaysRead : store.saltFor(day))
    const { keys, moveTo } = keysAt(Date.UTC(2026, 10, 10, 23, 59), loadSalt, 20)
    const lateView = keys.forToday()

    moveTo(Date.UTC(2026, 10, 11, 0, 1))
    await keys.forToday()
    failYesterdaysRead(new Error('connection refused'))

    await expect(lateView).rejects.toThrow()
    await keys.forToday()

    expect(store.readDays).toEqual(['2026-11-11'])
  })

  test('a page view gives up on a slow read, and the read is kept for the next one', async () => {
    const salt = randomBytes(32)
    let reads = 0
    let finishRead = (_salt: Uint8Array) => {}

    const loadSalt = () => {
      reads += 1

      return new Promise<Uint8Array>((resolve) => {
        finishRead = resolve
      })
    }

    const { keys } = keysAt(Date.UTC(2026, 10, 10, 12), loadSalt, 20)

    await expect(keys.forToday()).rejects.toThrow('read the visitor salt of 2026-11-10: no answer within 20 ms')

    finishRead(salt)

    expect((await keys.forToday()).day).toBe('2026-11-10')
    expect(reads).toBe(1)
  })
})
