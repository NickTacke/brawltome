import type { CanonicalRankedEffect, PostgresRankedPlayers } from './postgres'
import { type V0RankedSnapshot, decodeV0RankedSnapshot } from './source'

export interface V0RankedSource {
  getRanked(
    brawlhallaId: number,
    options: { caller: 'on-demand' | 'background'; onAttempt(): void },
  ): Promise<unknown | null>
}

export async function refreshCanonicalRankedPlayer(
  players: PostgresRankedPlayers,
  source: V0RankedSource,
  brawlhallaId: number,
  options: { caller: 'on-demand' | 'background' },
  effect: CanonicalRankedEffect,
): Promise<'applied' | 'already-applied'> {
  let attempted = false
  let snapshot: V0RankedSnapshot
  try {
    const payload = await source.getRanked(brawlhallaId, {
      ...options,
      onAttempt: () => {
        attempted = true
      },
    })
    if (payload === null) throw new Error(`V0 ranked snapshot unavailable for player ${brawlhallaId}`)
    snapshot = decodeV0RankedSnapshot(payload, brawlhallaId)
  } catch (error) {
    if (attempted && (await players.recordChecked(brawlhallaId, effect)) === 'lease-lost') {
      throw new Error(`Ranked refresh lease lost for player ${brawlhallaId}`, { cause: error })
    }
    throw error
  }

  try {
    const result = await players.applySnapshot(snapshot, effect)
    if (result === 'lease-lost') throw new Error(`Ranked refresh lease lost for player ${brawlhallaId}`)
    return result
  } catch (error) {
    if (attempted && (await players.recordChecked(brawlhallaId, effect)) === 'lease-lost') {
      throw new Error(`Ranked refresh lease lost for player ${brawlhallaId}`, { cause: error })
    }
    throw error
  }
}
