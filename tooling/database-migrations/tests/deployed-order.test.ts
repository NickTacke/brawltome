import { describe, expect, test } from 'bun:test'
import { deployedOrder } from '../src/deployed-order'
import { orderedMigrations } from '../src/inventories'
import { deployedHistory } from './fixtures/deployed-history'

describe('deployedOrder', () => {
  test('matches the production history in ordinal order', () => {
    expect([...deployedOrder]).toEqual(deployedHistory.map(({ identity }) => identity))
  })

  test('matches the identities, predecessors and checksums of the ordered module migrations', () => {
    const inventory = orderedMigrations.map(({ identity, predecessor, checksum }) => ({
      identity,
      predecessor,
      checksum,
    }))
    const history = deployedHistory.map(({ identity, predecessor, checksum }) => ({ identity, predecessor, checksum }))

    expect(inventory).toEqual(history)
  })
})
