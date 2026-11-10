import { describe, expect, test } from 'bun:test'
import { changeColour, hasPager } from '../src/components/queue/queue-format'

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
