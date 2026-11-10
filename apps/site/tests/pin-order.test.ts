import { describe, expect, test } from 'bun:test'
import { movePin, orderRows } from '../src/components/account/pin-order'

describe('movePin', () => {
  test('moves a pin up and down', () => {
    expect(movePin([1, 2, 3], null, 2, -1)).toEqual([2, 1, 3])
    expect(movePin([1, 2, 3], null, 2, 1)).toEqual([1, 3, 2])
  })

  test('cannot move the first pin up or the last one down', () => {
    expect(movePin([1, 2, 3], null, 1, -1)).toBeNull()
    expect(movePin([1, 2, 3], null, 3, 1)).toBeNull()
  })

  // the api refuses an order that moves the verified account, so it keeps its stored place
  test('steps over the verified account, which keeps its place', () => {
    expect(movePin([1, 7, 2, 3], 7, 2, -1)).toEqual([2, 7, 1, 3])
    expect(movePin([1, 7, 2, 3], 7, 1, 1)).toEqual([2, 7, 1, 3])
  })

  test('counts the first pin after the verified account as the top', () => {
    expect(movePin([7, 1, 2], 7, 1, -1)).toBeNull()
  })

  test('never moves the verified account itself', () => {
    expect(movePin([7, 1, 2], 7, 7, 1)).toBeNull()
  })

  test('ignores a verified account that is not pinned', () => {
    expect(movePin([1, 2], 7, 2, -1)).toEqual([2, 1])
  })

  test('cannot move a player that is not pinned', () => {
    expect(movePin([1, 2], null, 9, -1)).toBeNull()
  })
})

describe('orderRows', () => {
  const rows = [{ brawlhallaId: 1 }, { brawlhallaId: 2 }, { brawlhallaId: 3 }]

  test('puts the rows in the order the api answered', () => {
    expect(orderRows(rows, [3, 1, 2]).map(({ brawlhallaId }) => brawlhallaId)).toEqual([3, 1, 2])
  })

  test('drops a row the api no longer lists', () => {
    expect(orderRows(rows, [3, 1]).map(({ brawlhallaId }) => brawlhallaId)).toEqual([3, 1])
  })

  // the verified account is in the stored order but shown apart, so it has no row here
  test('skips an id without a row', () => {
    expect(orderRows(rows, [7, 2, 1, 3]).map(({ brawlhallaId }) => brawlhallaId)).toEqual([2, 1, 3])
  })
})
