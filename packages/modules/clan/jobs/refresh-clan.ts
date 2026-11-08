import type { PostgresClans } from '../db/postgres-clans'
import { parseGuildMembers } from '../domain/guild-members'
import { parseGuildStats } from '../domain/guild-stats'
import { failedCheckProvenance, successProvenance } from '../domain/provenance'
import type { ClanPublicationResult } from '../domain/publication'
import type { ClanRefreshEffect } from '../domain/refresh-effect'
import type { ClanRefreshSection } from '../domain/refresh-section'
import { classifySourceFailure } from '../domain/source-failure'

type SourceCallOptions = { caller: 'on-demand' | 'background' }

/** The guild endpoints; null means the source answered 404, which can't be told apart from a hiccup. */
export interface ClanSource {
  getGuildStatsV1(clanId: number, options: SourceCallOptions): Promise<unknown | null>
  getGuildMembersV1(clanId: number, options: SourceCallOptions): Promise<unknown | null>
}

export type ClanRefreshResult = { section: ClanRefreshSection; outcome: 'published' | 'preserved'; error?: string }

/** What refreshing a section reads and writes; the job adds what it needs to revoke a lost lease. */
export type ClanSectionStore = Pick<
  PostgresClans,
  'prepareRefreshEffect' | 'publishProfile' | 'publishRoster' | 'recordProfileCheck' | 'recordRosterCheck'
>

type SectionRefresh = {
  clans: ClanSectionStore
  source: ClanSource
  clanId: number
  section: ClanRefreshSection
  caller: 'on-demand' | 'background'
  checkedAt: Date
  effect?: ClanRefreshEffect
}

function fenced(section: ClanRefreshSection): ClanRefreshResult {
  return { section, outcome: 'preserved', error: `${section} effect was fenced` }
}

async function fetchAndPublish(refresh: SectionRefresh): Promise<ClanPublicationResult> {
  const { clans, source, clanId, section, caller, checkedAt, effect } = refresh
  const provenance = successProvenance(section)

  if (section === 'profile') {
    const payload = await source.getGuildStatsV1(clanId, { caller })

    if (payload === null) throw new Error('ambiguous guild stats 404')

    return clans.publishProfile(parseGuildStats(payload, clanId), checkedAt, provenance, effect)
  }

  const payload = await source.getGuildMembersV1(clanId, { caller })

  if (payload === null) throw new Error('ambiguous guild members 404')

  return clans.publishRoster(clanId, parseGuildMembers(payload, clanId), checkedAt, provenance, effect)
}

// the stored section stays as it was; only the check time and its outcome are recorded
async function recordFailedCheck(refresh: SectionRefresh, error: unknown): Promise<ClanRefreshResult> {
  const { clans, clanId, section, checkedAt, effect } = refresh
  const failure = classifySourceFailure(error)
  const provenance = failedCheckProvenance(section, failure)

  if (section === 'profile') await clans.recordProfileCheck(clanId, checkedAt, provenance, effect)
  else await clans.recordRosterCheck(clanId, checkedAt, provenance, effect)

  if (failure.isRetryable) throw error

  const message = error instanceof Error ? error.message : 'Unknown source failure'

  return { section, outcome: 'preserved', error: message }
}

/**
 * Fetches one section of a clan and publishes it. With an effect, the lease is raised before the source is called,
 * so a fenced worker never spends a source call. A failed fetch keeps the stored section and records the check.
 */
export async function processRefreshClanSection(
  clans: ClanSectionStore,
  source: ClanSource,
  clanId: number,
  section: ClanRefreshSection,
  caller: 'on-demand' | 'background' = 'background',
  checkedAt = new Date(),
  effect?: ClanRefreshEffect,
): Promise<ClanRefreshResult> {
  const refresh = { clans, source, clanId, section, caller, checkedAt, effect }

  if (effect) {
    const preparation = await clans.prepareRefreshEffect(effect)

    if (preparation === 'already-applied') return { section, outcome: 'published' }

    if (preparation === 'fenced') return fenced(section)
  }

  try {
    const publication = await fetchAndPublish(refresh)

    if (publication === 'fenced') return fenced(section)

    return { section, outcome: 'published' }
  } catch (error) {
    return recordFailedCheck(refresh, error)
  }
}

/** Refreshes a clan's profile and roster independently, so one failing leaves the other published. */
export async function processRefreshClan(
  dependencies: { clans: PostgresClans; source: ClanSource },
  clanId: number,
  caller: 'on-demand' | 'background' = 'background',
): Promise<ClanRefreshResult[]> {
  const sections: ClanRefreshSection[] = ['profile', 'roster']

  return Promise.all(
    sections.map((section) =>
      processRefreshClanSection(dependencies.clans, dependencies.source, clanId, section, caller),
    ),
  )
}
