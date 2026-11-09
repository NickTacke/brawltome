import { describe, expect, mock, test } from 'bun:test'
import { detectSeasonStarts } from '../ranked/season-starts'
import { createSeasonStartsCache } from '../ranked/season-starts-cache'

const seasonThirtyNine = { season: 39, startsAt: '1970-01-01T00:00:00.000Z' }

const days = [
  { day: '2026-03-25', drops: 62, points: 23579 },
  { day: '2026-03-26', drops: 94, points: 575 },
  { day: '2026-03-29', drops: 54, points: 178 },
  { day: '2026-04-06', drops: 95, points: 260 },
  { day: '2026-05-31', drops: 34, points: 270 },
  { day: '2026-06-23', drops: 31, points: 226 },
  { day: '2026-06-24', drops: 95, points: 266 },
  { day: '2026-07-28', drops: 33, points: 108 },
  { day: '2026-09-22', drops: 9, points: 156 },
  { day: '2026-09-23', drops: 36, points: 133 },
  { day: '2026-10-05', drops: 294, points: 482 },
]

describe('detectSeasonStarts', () => {
  test('finds each reset and rounds it to its wednesday', () => {
    expect(detectSeasonStarts(days)).toEqual([
      seasonThirtyNine,
      { season: 40, startsAt: '2026-03-25T14:00:00.000Z' },
      { season: 41, startsAt: '2026-06-24T14:00:00.000Z' },
      { season: 42, startsAt: '2026-09-23T14:00:00.000Z' },
    ])
  })

  test('returns only the first season with no history', () => {
    expect(detectSeasonStarts([])).toEqual([seasonThirtyNine])
  })

  test('ignores a day with too few falling game counts', () => {
    expect(detectSeasonStarts([{ day: '2026-03-25', drops: 29, points: 50 }])).toEqual([seasonThirtyNine])
  })

  test('ignores a day just under the share', () => {
    expect(detectSeasonStarts([{ day: '2026-03-25', drops: 30, points: 121 }])).toEqual([seasonThirtyNine])
  })

  test('counts a day exactly at the share', () => {
    expect(detectSeasonStarts([{ day: '2026-03-25', drops: 30, points: 120 }])).toEqual([
      seasonThirtyNine,
      { season: 40, startsAt: '2026-03-25T14:00:00.000Z' },
    ])
  })
})

describe('createSeasonStartsCache', () => {
  const firstAnswer = [seasonThirtyNine]
  const secondAnswer = [seasonThirtyNine, { season: 40, startsAt: '2026-03-25T14:00:00.000Z' }]
  const oneHourMs = 60 * 60 * 1000

  test('reads once inside the hour', async () => {
    const read = mock(async () => firstAnswer)
    const cached = createSeasonStartsCache(read, () => 1000)

    await cached()

    expect(await cached()).toEqual(firstAnswer)
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('shares one read between callers that arrive together', async () => {
    const read = mock(async () => firstAnswer)
    const cached = createSeasonStartsCache(read, () => 1000)

    const answers = await Promise.all([cached(), cached(), cached()])

    expect(answers).toEqual([firstAnswer, firstAnswer, firstAnswer])
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('reads again after the hour', async () => {
    let nowMs = 0
    const read = mock(async () => (nowMs === 0 ? firstAnswer : secondAnswer))
    const cached = createSeasonStartsCache(read, () => nowMs)

    await cached()

    nowMs = oneHourMs

    expect(await cached()).toEqual(secondAnswer)
    expect(read).toHaveBeenCalledTimes(2)
  })

  test('keeps the last good answer when a refresh fails', async () => {
    let nowMs = 0
    let shouldFail = false

    const read = mock(async () => {
      if (shouldFail) throw new Error('read failed')

      return firstAnswer
    })

    const cached = createSeasonStartsCache(read, () => nowMs)

    await cached()

    nowMs = oneHourMs
    shouldFail = true

    expect(await cached()).toEqual(firstAnswer)
  })

  test('rejects when the first read fails', () => {
    const cached = createSeasonStartsCache(async () => {
      throw new Error('read failed')
    })

    expect(cached()).rejects.toThrow('read failed')
  })
})
