import { describe, expect, mock, test } from 'bun:test'

const actual = await import('../../src/lib/analytics/browser')
const trackMock = mock(() => {})
mock.module('../../src/lib/analytics/browser', () => ({ ...actual, track: trackMock, flushAnalytics: () => {} }))

const { trackDeadEndOnce } = await import('../../src/components/TrackDeadEnd')

describe('trackDeadEndOnce', () => {
  test('tracks a single deadend event', () => {
    trackDeadEndOnce('404', trackMock)
    expect(trackMock).toHaveBeenCalledTimes(1)
    expect(trackMock).toHaveBeenCalledWith({ name: 'deadend', kind: '404' })
  })
})
