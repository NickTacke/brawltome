import { type RankedClanListContract, rankedClanListSchema } from '@brawltome/contracts'
import type { RankedPage } from '../components/ranked-page'
import { readApi } from './api'
import { readOptional } from './optional-read'

export type RankedGuild = RankedClanListContract['entries'][number]

async function readGuildRanking(page: number): Promise<RankedPage<RankedGuild>> {
  const list = await readApi(`/clans?page=${page}`, rankedClanListSchema, `load guild ranking page ${page}`)

  return { entries: list.entries, totalRows: list.totalRows, pageSize: list.pageSize }
}

/** One page of guilds ranked by guild points, or null when it couldn't be read, so the page can still show. */
export function loadGuildRanking(page: number): Promise<RankedPage<RankedGuild> | null> {
  return readOptional(() => readGuildRanking(page), null)
}
