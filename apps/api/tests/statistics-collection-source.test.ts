import { describe, expect, test } from 'bun:test'
import { createStatisticsCollectionQueue, STATISTICS_COLLECTION_SPACING_MS } from '../src/statistics-collection-source'

describe('Statistics collection request queue', () => {
  test('spaces calls evenly over the 150 per 15 minutes the cohort declares', () => {
    expect(STATISTICS_COLLECTION_SPACING_MS).toBe(6_000)
    expect(createStatisticsCollectionQueue().remainingBackground).toBe(150)
  })

  test('holds the next call instead of releasing a burst', async () => {
    const queue = createStatisticsCollectionQueue()

    await queue.acquire('background')

    const next = queue.acquire('background').then(() => 'released')
    const outcome = await Promise.race([next, Bun.sleep(100).then(() => 'waiting')])

    expect(outcome).toBe('waiting')
  })
})
