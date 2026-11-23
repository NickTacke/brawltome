import type { PlayerEsportsContract } from '@brawltome/contracts'
import type { Database } from '@brawltome/foundation'
import { type PlayerRow, readStoredEsports } from '../db/read-stored-esports'
import {
  buildLegendLookup,
  type EsportsProfile,
  esportsFreshness,
  isTrustedLink,
  type LinkEvidence,
  resolveLegendKey,
  type StoredEsports,
  shapeEsportsProfile,
} from '../domain'
import { enqueueEsportsRefresh } from '../jobs/enqueue-esports-jobs'
import { type AccountSignals, isKnownAccount, readAccountSignals } from './account-signals'

const legendLookup = buildLegendLookup()

// a mode without a power ranking comes back with an empty region
function rankingRegion(region: string | undefined): string | null {
  if (region === undefined || region === '') return null

  return region
}

function linkEvidence(row: PlayerRow, account: AccountSignals): LinkEvidence {
  const esportsRegion = rankingRegion(row.powerRanking1v1?.pr.region) ?? rankingRegion(row.powerRanking2v2?.pr.region)

  return {
    esportsName: row.brawltoolsName ?? '',
    // stored most played first, and the trust rule reads the first three; a legend the site has no key for keeps its
    // place under its brawltools name, which matches nothing
    eventLegends: row.eventLegends.map(({ name }) => resolveLegendKey(name, legendLookup) ?? name),
    esportsRegion,
    accountNames: account.names,
    accountTopLegends: account.topLegends,
    accountRegion: account.region,
  }
}

// the account is read on every request, so a new name or alias counts as soon as the player module has it
async function readTrustedProfile(
  database: Database,
  row: PlayerRow,
  stored: StoredEsports,
): Promise<EsportsProfile | null> {
  const account = await readAccountSignals(database, row.brawlhallaId)

  if (!isTrustedLink(linkEvidence(row, account))) return null

  return shapeEsportsProfile(stored, legendLookup)
}

// the trust rule checks a record against the account's names, region and legends, so for an id the player module
// doesn't know a refresh could never show anything; asking anyway would let a crawler walking ids fill the queue.
// a refresh that can't be queued must not cost the visitor the page; the next view asks again
async function requestRefresh(database: Database, brawlhallaId: number): Promise<void> {
  try {
    if (!(await isKnownAccount(database, brawlhallaId))) return

    await enqueueEsportsRefresh(database, brawlhallaId)
  } catch (error) {
    console.error(`queue an esports refresh for player ${brawlhallaId}:`, error)
  }
}

/**
 * A player's esports profile and whether the stored data is due a refresh, which the read then asks for. The profile
 * shows only when Brawltools links the account and the record can be trusted to be theirs.
 */
export async function readPlayerEsports(
  database: Database,
  brawlhallaId: number,
  now: Date,
): Promise<PlayerEsportsContract> {
  const { row, stored } = await readStoredEsports(database, brawlhallaId)
  const freshness = esportsFreshness(row, now)

  if (freshness !== 'fresh') await requestRefresh(database, brawlhallaId)

  if (row?.link !== 'linked') return { profile: null, freshness }

  const profile = await readTrustedProfile(database, row, stored)

  return { profile, freshness }
}
