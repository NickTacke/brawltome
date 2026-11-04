import { describe, expect, test } from 'bun:test'
import { deployedOrder } from '../src/deployed-order'
import { orderedMigrations } from '../src/inventories'
import { deployedHistory } from './fixtures/deployed-history'

describe('deployedOrder', () => {
  test('matches the production history in ordinal order', () => {
    expect([...deployedOrder]).toEqual(deployedHistory.map(({ identity }) => identity))
  })

  test('starts with the deployed migrations, unchanged', () => {
    const deployedMigrations = orderedMigrations.slice(0, deployedHistory.length)

    const inventory = deployedMigrations.map(({ identity, predecessor, checksum }) => ({
      identity,
      predecessor,
      checksum,
    }))
    const history = deployedHistory.map(({ identity, predecessor, checksum }) => ({ identity, predecessor, checksum }))

    expect(inventory).toEqual(history)
  })
})
