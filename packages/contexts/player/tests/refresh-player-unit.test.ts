import { describe, expect, it } from 'bun:test'
import { processRefreshRanked, processRefreshStats } from '../commands/refresh-player'

describe('player refresh availability', () => {
  it('rejects when lifetime stats are unavailable', async () => {
    const bhapi = { getPlayerStatsV1: async () => null }

    expect(processRefreshStats({ db: {} as never, bhapi: bhapi as never }, 123)).rejects.toThrow(
      'lifetime stats unavailable',
    )
  })

  it('rejects ambiguous ranked absence before persistence', async () => {
    const bhapi = { getPlayerStatsV1: async () => null }

    expect(processRefreshRanked({ db: {} as never, bhapi: bhapi as never }, 123)).rejects.toThrow(
      'ranked stats unavailable',
    )
  })
})
