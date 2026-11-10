import { describe, expect, test } from 'bun:test'
import type { LeaderboardRecentActivityOutput } from '@brawltome/contracts'
import { queueMessage } from '../src/components/queue/queue-message'
import { activityView, unavailableView } from './queue-fixtures'

describe('queueMessage', () => {
  test('a board scanned for less than an hour has not enough history', () => {
    expect(queueMessage(unavailableView('not_enough_history'))?.title).toBe('Not enough history yet')
  })

  test('a missed scan says so and that it comes back', () => {
    const message = queueMessage(unavailableView('scan_gap'))

    expect(message?.title).toBe('A scan was missed')
    expect(message?.body).toContain('next scan')
  })

  test('an hour without games says nobody played', () => {
    expect(queueMessage(activityView(0))?.title).toBe('Nobody played')
  })

  test('a page past the end is not mistaken for an empty hour', () => {
    const pastTheEnd: LeaderboardRecentActivityOutput = { ...activityView(0), page: 4, totalRows: 31 }

    expect(queueMessage(pastTheEnd)?.title).toBe('No one on this page')
  })

  test('an hour with players needs no message', () => {
    expect(queueMessage(activityView(3))).toBeNull()
  })
})
