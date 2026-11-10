import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { type BoardMode, type BoardRegion, parseMode, parseRegion } from '../components/home/home-filters'
import { pickRegion, regionCookieName } from '../components/home/region-cookie'
import { loadMostPlayedLegends } from './load-most-played-legends'
import { loadPatches } from './load-patches'
import { loadTopGuilds } from './load-top-guilds'
import { loadTopPlayers } from './load-top-players'
import { servedFromBrawlTome } from './patch-image-names'

type BoardQuery = { mode: BoardMode; region?: BoardRegion }

function parseBoardQuery(query: BoardQuery): BoardQuery {
  return { mode: parseMode(query.mode), region: parseRegion(query.region) }
}

// the remembered region is read here, so the first html already shows the visitor's board
export const getTopPlayers = createServerFn({ method: 'GET' })
  .validator(parseBoardQuery)
  .handler(async ({ data }) => {
    const region = pickRegion(data.region, getCookie(regionCookieName))
    const entries = await loadTopPlayers(data.mode, region)

    return { region, entries }
  })

export const getTopGuilds = createServerFn({ method: 'GET' }).handler(() => loadTopGuilds())

export const getPatches = createServerFn({ method: 'GET' }).handler(async () => {
  const notes = await loadPatches()

  return notes && servedFromBrawlTome(notes)
})

export const getMostPlayedLegends = createServerFn({ method: 'GET' }).handler(() => loadMostPlayedLegends())
