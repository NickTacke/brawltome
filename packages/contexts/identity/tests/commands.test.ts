import { describe, expect, mock, test } from 'bun:test'
import { linkPlayer } from '../commands/link-player'
import { resolveSteamLink } from '../commands/resolve-steam-link'
import { unlinkPlayer } from '../commands/unlink-player'
import type { PlayerLinkRepo } from '../playerLink.repo'

function mockPlayerLinkRepo(overrides: Partial<PlayerLinkRepo> = {}): PlayerLinkRepo {
  return {
    findByUserId: mock(async () => null),
    findByBrawlhallaId: mock(async () => null),
    createPending: mock(async () => ({
      userId: 'user-1',
      brawlhallaId: null,
      steamId: '76561198000000000',
      linkedVia: 'steam' as const,
      status: 'pending' as const,
      linkedAt: new Date(),
    })),
    resolve: mock(async () => {}),
    setStatus: mock(async () => {}),
    deleteByUserId: mock(async () => {}),
    ...overrides,
  }
}

describe('linkPlayer', () => {
  test('creates pending link when user has no existing link', async () => {
    const repo = mockPlayerLinkRepo()
    const result = await linkPlayer({ playerLinkRepo: repo }, { userId: 'user-1', steamId: '765' })
    expect(result.status).toBe('pending')
    expect(repo.createPending).toHaveBeenCalledTimes(1)
  })

  test('throws when user has an active linked player', async () => {
    const repo = mockPlayerLinkRepo({
      findByUserId: mock(async () => ({
        userId: 'user-1',
        brawlhallaId: 123,
        steamId: '765',
        linkedVia: 'steam' as const,
        status: 'linked' as const,
        linkedAt: new Date(),
      })),
    })
    await expect(linkPlayer({ playerLinkRepo: repo }, { userId: 'user-1', steamId: '765' })).rejects.toThrow()
  })

  test('throws when user has a pending link', async () => {
    const repo = mockPlayerLinkRepo({
      findByUserId: mock(async () => ({
        userId: 'user-1',
        brawlhallaId: null,
        steamId: '765',
        linkedVia: 'steam' as const,
        status: 'pending' as const,
        linkedAt: new Date(),
      })),
    })
    await expect(linkPlayer({ playerLinkRepo: repo }, { userId: 'user-1', steamId: '765' })).rejects.toThrow()
  })

  test('clears stale failed link and creates new pending', async () => {
    const repo = mockPlayerLinkRepo({
      findByUserId: mock(async () => ({
        userId: 'user-1',
        brawlhallaId: null,
        steamId: '765',
        linkedVia: 'steam' as const,
        status: 'failed' as const,
        linkedAt: new Date(),
      })),
    })
    const result = await linkPlayer({ playerLinkRepo: repo }, { userId: 'user-1', steamId: '999' })
    expect(repo.deleteByUserId).toHaveBeenCalledWith('user-1')
    expect(result.status).toBe('pending')
  })
})

describe('resolveSteamLink', () => {
  test('skips if no pending link exists', async () => {
    const repo = mockPlayerLinkRepo()
    const bhapi = { searchBySteamId: mock(async () => ({ brawlhalla_id: 999, name: 'TestPlayer' })) }
    await resolveSteamLink({ playerLinkRepo: repo, bhapi }, { userId: 'user-1', steamId: '765' })
    expect(bhapi.searchBySteamId).not.toHaveBeenCalled()
  })

  test('resolves when BH ID found and unclaimed', async () => {
    const repo = mockPlayerLinkRepo({
      findByUserId: mock(async () => ({
        userId: 'user-1',
        brawlhallaId: null,
        steamId: '765',
        linkedVia: 'steam' as const,
        status: 'pending' as const,
        linkedAt: new Date(),
      })),
    })
    const bhapi = { searchBySteamId: mock(async () => ({ brawlhalla_id: 999, name: 'TestPlayer' })) }
    await resolveSteamLink({ playerLinkRepo: repo, bhapi }, { userId: 'user-1', steamId: '765' })
    expect(repo.resolve).toHaveBeenCalledWith('user-1', 999)
  })

  test('sets conflict when BH ID already claimed', async () => {
    const pendingLink = {
      userId: 'user-1',
      brawlhallaId: null,
      steamId: '765',
      linkedVia: 'steam' as const,
      status: 'pending' as const,
      linkedAt: new Date(),
    }
    const repo = mockPlayerLinkRepo({
      findByUserId: mock(async () => pendingLink),
      findByBrawlhallaId: mock(async () => ({
        userId: 'other-user',
        brawlhallaId: 999,
        steamId: '111',
        linkedVia: 'steam' as const,
        status: 'linked' as const,
        linkedAt: new Date(),
      })),
    })
    const bhapi = { searchBySteamId: mock(async () => ({ brawlhalla_id: 999, name: 'TestPlayer' })) }
    await resolveSteamLink({ playerLinkRepo: repo, bhapi }, { userId: 'user-1', steamId: '765' })
    expect(repo.setStatus).toHaveBeenCalledWith('user-1', 'conflict')
  })

  test('sets failed when Steam ID not found in BH API', async () => {
    const repo = mockPlayerLinkRepo({
      findByUserId: mock(async () => ({
        userId: 'user-1',
        brawlhallaId: null,
        steamId: '765',
        linkedVia: 'steam' as const,
        status: 'pending' as const,
        linkedAt: new Date(),
      })),
    })
    const bhapi = { searchBySteamId: mock(async () => null) }
    await resolveSteamLink({ playerLinkRepo: repo, bhapi }, { userId: 'user-1', steamId: '765' })
    expect(repo.setStatus).toHaveBeenCalledWith('user-1', 'failed')
  })
})

describe('unlinkPlayer', () => {
  test('deletes link by userId', async () => {
    const repo = mockPlayerLinkRepo()
    await unlinkPlayer({ playerLinkRepo: repo }, 'user-1')
    expect(repo.deleteByUserId).toHaveBeenCalledWith('user-1')
  })
})
