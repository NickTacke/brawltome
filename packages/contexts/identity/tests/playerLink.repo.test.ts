import { describe, expect, test } from 'bun:test'
import type { PlayerLinkRepo } from '../playerLink.repo'

// Type-level test: verify the repo interface shape
describe('PlayerLinkRepo interface', () => {
  test('has required methods', () => {
    const repo: PlayerLinkRepo = {
      findByUserId: async () => null,
      findByBrawlhallaId: async () => null,
      createPending: async () => ({
        userId: '123',
        brawlhallaId: null,
        steamId: '76561198000000000',
        linkedVia: 'steam' as const,
        status: 'pending' as const,
        linkedAt: new Date(),
      }),
      resolve: async () => {},
      setStatus: async () => {},
      deleteByUserId: async () => {},
    }
    expect(repo).toBeDefined()
  })
})
