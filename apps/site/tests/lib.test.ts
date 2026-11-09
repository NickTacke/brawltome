import { describe, expect, test } from 'bun:test'
import { fixEncoding, formatDay, formatWhole, timeAgo } from '../src/lib'

describe('formatWhole', () => {
  test('groups a numeric string by thousands', () => {
    expect(formatWhole('12750731')).toBe('12,750,731')
  })

  test('keeps precision above the safe integer range', () => {
    expect(formatWhole(9007199254740993n)).toBe('9,007,199,254,740,993')
  })
})

describe('formatDay', () => {
  test('says unknown when there is no date', () => {
    expect(formatDay(null)).toBe('Unknown')
  })

  test('formats the day in utc', () => {
    expect(formatDay('2024-03-01T23:30:00Z')).toBe('1 Mar 2024')
  })
})

describe('timeAgo', () => {
  const now = new Date('2026-11-09T12:00:00Z')

  function secondsBeforeNow(seconds: number): string {
    return new Date(now.getTime() - seconds * 1000).toISOString()
  }

  test('says just now under a minute', () => {
    expect(timeAgo(secondsBeforeNow(59), now)).toBe('just now')
  })

  test('counts whole minutes', () => {
    expect(timeAgo(secondsBeforeNow(90), now)).toBe('1 min ago')
  })

  test('counts whole hours', () => {
    expect(timeAgo(secondsBeforeNow(2 * 60 * 60), now)).toBe('2 h ago')
  })

  test('counts whole days', () => {
    expect(timeAgo(secondsBeforeNow(3 * 24 * 60 * 60), now)).toBe('3 d ago')
  })
})

describe('fixEncoding', () => {
  test('repairs a name stored as utf-8 read as latin-1', () => {
    expect(fixEncoding('MÃ¼ller')).toBe('Müller')
  })

  test('leaves a correctly encoded name alone', () => {
    expect(fixEncoding('Müller')).toBe('Müller')
  })

  test('turns a missing name into an empty string', () => {
    expect(fixEncoding(null)).toBe('')
  })
})
