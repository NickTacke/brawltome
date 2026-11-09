import type { RankedClanListContract } from '@brawltome/contracts'
import type { Database } from '@brawltome/foundation'
import { listRankedClans, type RankedClansPage } from '../db/list-ranked-clans'

const rankedClanPageSize = 30

function toRankedClanList(result: RankedClansPage, page: number): RankedClanListContract {
  return {
    page,
    pageSize: rankedClanPageSize,
    hasMore: page * rankedClanPageSize < result.totalRows,
    totalRows: result.totalRows,
    entries: result.rows,
  }
}

/** One page of the guild list, ranked across all stored guilds. */
export async function readRankedClans(database: Database, page: number): Promise<RankedClanListContract> {
  const result = await listRankedClans(database, { page, pageSize: rankedClanPageSize })

  return toRankedClanList(result, page)
}
