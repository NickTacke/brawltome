import { describe, expect, test } from 'bun:test'
import {
  buildQueueFilterQueryString,
  buildQueuePageQueryString,
  formatSignedDelta,
  parseQueuePreference,
  parseQueueSearchParams,
  queuePreferenceValue,
} from '../../../src/components/Queue/utils'

const snapshotId = '10000000-0000-4000-8000-000000000004'

describe('Queue URL filters', () => {
  test('defaults missing, invalid, array, and out-of-range values', () => {
    expect(parseQueueSearchParams({})).toEqual({ mode: '1v1', region: 'all', page: 1, snapshotId: undefined })
    expect(
      parseQueueSearchParams({ mode: 'retired', region: 'mars', page: '0', snapshotId: ['bad', snapshotId] }),
    ).toEqual({ mode: '1v1', region: 'all', page: 1, snapshotId: undefined })
    expect(parseQueueSearchParams({ page: '9999', snapshotId: 'not-a-uuid' })).toEqual({
      mode: '1v1',
      region: 'all',
      page: 500,
      snapshotId: undefined,
    })
  })

  test('round-trips every mode and scope with a complete snapshot UUID', () => {
    for (const mode of ['1v1', '2v2', 'solo2v2', '3v3'] as const) {
      for (const region of ['all', 'US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'] as const) {
        expect(parseQueueSearchParams({ mode, region, page: '500', snapshotId })).toEqual({
          mode,
          region,
          page: 500,
          snapshotId,
        })
      }
    }
  })

  test('serializes current filters while pinning pagination to the current output snapshot', () => {
    const filters = { mode: '1v1' as const, region: 'EU' as const, page: 3, snapshotId }
    expect(buildQueueFilterQueryString(filters)).toBe('mode=1v1&region=EU&page=3')
    expect(buildQueuePageQueryString(filters, 4, snapshotId)).toBe(`mode=1v1&region=EU&page=4&snapshotId=${snapshotId}`)
  })
})

describe('Queue browser preference', () => {
  test('validates one versioned mode and region pair', () => {
    expect(parseQueuePreference('v1.2v2.EU')).toEqual({ mode: '2v2', region: 'EU' })
    for (const value of [undefined, '', 'v2.2v2.EU', 'v1.retired.EU', 'v1.2v2.mars', 'v1.2v2.EU.extra']) {
      expect(parseQueuePreference(value)).toBeUndefined()
    }
  })

  test('uses remembered filters as defaults while valid URL filters win', () => {
    const remembered = { mode: '2v2' as const, region: 'EU' as const }
    expect(parseQueueSearchParams({}, remembered)).toEqual({
      mode: '2v2',
      region: 'EU',
      page: 1,
      snapshotId: undefined,
    })
    expect(parseQueueSearchParams({ mode: '3v3', region: 'US-W' }, remembered)).toMatchObject({
      mode: '3v3',
      region: 'US-W',
    })
  })

  test('serializes the versioned preference value', () => {
    expect(queuePreferenceValue({ mode: 'solo2v2', region: 'US-E' })).toBe('v1.solo2v2.US-E')
  })
})

describe('Queue signed deltas', () => {
  test('formats positive, zero, and negative values', () => {
    expect(formatSignedDelta(12)).toBe('+12')
    expect(formatSignedDelta(0)).toBe('0')
    expect(formatSignedDelta(-12)).toBe('-12')
  })
})
