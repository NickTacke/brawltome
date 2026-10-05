import { describe, expect, mock, test } from 'bun:test'

import { trackDeadEndOnce } from '../../src/components/TrackDeadEnd'

const trackMock = mock(() => {})

describe('trackDeadEndOnce', () => {
  test('tracks a single deadend event', () => {
    trackDeadEndOnce('404', trackMock)
    expect(trackMock).toHaveBeenCalledTimes(1)
    expect(trackMock).toHaveBeenCalledWith({ name: 'deadend', kind: '404' })
  })
})
