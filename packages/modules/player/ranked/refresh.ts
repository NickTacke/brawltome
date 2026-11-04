import type { CanonicalRankedEffect, PostgresRankedPlayers, RankedWriteResult } from './postgres'
import {
  type V0RankedSnapshot,
  type V1FixedTeamPulse,
  decodeV0RankedSnapshot,
  decodeV1FixedTeamPulses,
  decodeV1OneVsOnePulse,
} from './source'

export interface V0RankedSource {
  getRanked(
    brawlhallaId: number,
    options: { caller: 'on-demand' | 'background'; onAttempt(): void },
  ): Promise<unknown | null>
}

export interface V1RankedPulseSource {
  getOneVsOne(
    brawlhallaId: number,
    options: { caller: 'on-demand' | 'background'; onAttempt(): void },
  ): Promise<unknown | null>
  getFixedTeams(
    brawlhallaId: number,
    options: { caller: 'on-demand' | 'background'; onAttempt(): void },
  ): Promise<unknown | null>
}

export async function refreshRankedPlayerPulse(
  players: PostgresRankedPlayers,
  source: V1RankedPulseSource,
  brawlhallaId: number,
  options: { caller: 'on-demand' | 'background' },
  effect: CanonicalRankedEffect,
): Promise<Exclude<RankedWriteResult, 'lease-lost'>> {
  let attempted = false
  let oneVsOneAttempted = false
  let oneVsOne = null
  try {
    const payload = await source.getOneVsOne(brawlhallaId, {
      ...options,
      onAttempt: () => {
        attempted = true
        oneVsOneAttempted = true
      },
    })
    oneVsOne = payload === null ? null : decodeV1OneVsOnePulse(payload, brawlhallaId)
  } catch (error) {
    if (!oneVsOneAttempted) throw error
    oneVsOne = null
  }

  let fixedTeamsAttempted = false
  let fixedTeams: V1FixedTeamPulse[] = []
  try {
    const payload = await source.getFixedTeams(brawlhallaId, {
      ...options,
      onAttempt: () => {
        attempted = true
        fixedTeamsAttempted = true
      },
    })
    fixedTeams = decodeV1FixedTeamPulses(payload, brawlhallaId)
  } catch (error) {
    if (!fixedTeamsAttempted) throw error
    fixedTeams = []
  }

  if (!oneVsOne && fixedTeams.length === 0) {
    const checked = attempted ? await players.recordPulseChecked(brawlhallaId, effect) : 'no-op'
    if (checked === 'lease-lost') throw new Error(`Ranked pulse lease lost for player ${brawlhallaId}`)
    return 'no-op'
  }

  const result = await players.applyPulse({ brawlhallaId, oneVsOne, fixedTeams }, effect)
  if (result === 'lease-lost') throw new Error(`Ranked pulse lease lost for player ${brawlhallaId}`)
  return result
}

export async function refreshCanonicalRankedPlayer(
  players: PostgresRankedPlayers,
  source: V0RankedSource,
  brawlhallaId: number,
  options: { caller: 'on-demand' | 'background' },
  effect: CanonicalRankedEffect,
): Promise<'applied' | 'already-applied' | 'stale'> {
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
