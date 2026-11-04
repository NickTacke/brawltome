import type { CanonicalCareerEffect, PostgresCareerPlayers } from './postgres'
import { type CareerLegendResolver, type V0CareerSnapshot, decodeV0CareerSnapshot } from './source'

export interface V0CareerSource {
  getStats(
    brawlhallaId: number,
    options: { caller: 'on-demand' | 'background'; onAttempt(): void },
  ): Promise<unknown | null>
}

export async function refreshCanonicalCareerPlayer(
  players: PostgresCareerPlayers,
  source: V0CareerSource,
  brawlhallaId: number,
  options: { caller: 'on-demand' | 'background' },
  effect: CanonicalCareerEffect,
  resolveLegend: CareerLegendResolver,
): Promise<'applied' | 'already-applied'> {
  let attempted = false
  let snapshot: V0CareerSnapshot
  try {
    const payload = await source.getStats(brawlhallaId, {
      ...options,
      onAttempt: () => {
        attempted = true
      },
    })
    if (payload === null) throw new Error(`V0 career snapshot unavailable for player ${brawlhallaId}`)
    snapshot = decodeV0CareerSnapshot(payload, brawlhallaId, resolveLegend)
  } catch (error) {
    if (attempted && (await players.recordChecked(brawlhallaId, effect)) === 'lease-lost') {
      throw new Error(`Career refresh lease lost for player ${brawlhallaId}`, { cause: error })
    }
    throw error
  }

  try {
    const result = await players.applySnapshot(snapshot, effect)
    if (result === 'lease-lost') throw new Error(`Career refresh lease lost for player ${brawlhallaId}`)
    return result
  } catch (error) {
    if (attempted && (await players.recordChecked(brawlhallaId, effect)) === 'lease-lost') {
      throw new Error(`Career refresh lease lost for player ${brawlhallaId}`, { cause: error })
    }
    throw error
  }
}
