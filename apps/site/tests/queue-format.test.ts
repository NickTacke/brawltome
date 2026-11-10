import { describe, expect, test } from 'bun:test'
import { changeColour, hasPager, spanLabel } from '../src/components/queue/queue-format'

describe('changeColour', () => {
  test('colours gains and drops the way the player page does', () => {
    expect(changeColour(24)).toBe('text-emerald-400')
    expect(changeColour(-18)).toBe('text-red-400')
  })

  test('leaves an unchanged rating quiet', () => {
    expect(changeColour(0)).toBe('text-soft')
  })
})

describe('hasPager', () => {
  test('shows the pager when the hour spans more than one page', () => {
    expect(hasPager({ page: 1, totalRows: 31, pageSize: 30 })).toBe(true)
  })

  test('hides it when everything fits on the first page', () => {
    expect(hasPager({ page: 1, totalRows: 30, pageSize: 30 })).toBe(false)
  })

  test('keeps it on a page past the end, so the reader can get back', () => {
    expect(hasPager({ page: 2, totalRows: 12, pageSize: 30 })).toBe(true)
  })
})

describe('spanLabel', () => {
  const previousObservedAt = '2026-11-10T00:52:00.000Z'

  function labelUntil(currentObservedAt: string): string {
    return spanLabel({ previousObservedAt, currentObservedAt })
  }

  test('names a span under an hour in minutes', () => {
    expect(labelUntil('2026-11-10T01:37:00.000Z')).toBe('Last 45 min')
  })

  test('calls a span of about an hour the last hour', () => {
    expect(labelUntil('2026-11-10T01:53:40.000Z')).toBe('Last hour')
  })

  test('names a longer span in hours and minutes', () => {
    expect(labelUntil('2026-11-10T02:07:00.000Z')).toBe('Last 1 h 15 min')
  })

  test('names whole hours without minutes', () => {
    expect(labelUntil('2026-11-10T02:52:00.000Z')).toBe('Last 2 hours')
  })

  test('rounds to the nearest 5 minutes', () => {
    expect(labelUntil('2026-11-10T01:39:29.000Z')).toBe('Last 45 min')
    expect(labelUntil('2026-11-10T01:39:31.000Z')).toBe('Last 50 min')
    expect(labelUntil('2026-11-10T02:09:00.000Z')).toBe('Last 1 h 15 min')
  })
})
