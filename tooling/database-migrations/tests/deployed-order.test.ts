import { describe, expect, test } from 'bun:test'
import { deployedOrder } from '../src/deployed-order'
import { globalMigrationInventory } from '../src/inventories'
import { deployedHistory } from './fixtures/deployed-history'

describe('deployedOrder', () => {
  test('matches the production history in ordinal order', () => {
    expect([...deployedOrder]).toEqual(deployedHistory.map(({ identity }) => identity))
  })

  test('matches the global inventory identities, predecessors and checksums', () => {
    const inventory = globalMigrationInventory.map(({ identity, predecessor, checksum }) => ({
      identity,
      predecessor,
      checksum,
    }))
    const history = deployedHistory.map(({ identity, predecessor, checksum }) => ({ identity, predecessor, checksum }))

    expect(inventory).toEqual(history)
  })
})
