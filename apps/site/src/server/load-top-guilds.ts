import { type RankedClanListContract, rankedClanListSchema } from '@brawltome/contracts'
import { readApi } from './api'
import { readOptional } from './optional-read'

export type TopGuild = RankedClanListContract['entries'][number]

const topGuildCount = 5

async function readTopGuilds(): Promise<TopGuild[]> {
  const list = await readApi('/clans?page=1', rankedClanListSchema, 'load top guilds')

  return list.entries.slice(0, topGuildCount)
}

/** The highest ranked guilds, or null when they couldn't be read, so the rest of Home can still show. */
export function loadTopGuilds(): Promise<TopGuild[] | null> {
  return readOptional(readTopGuilds, null)
}
