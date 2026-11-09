import {
  nullablePlayerCareerProfileSchema,
  nullablePlayerRankedProfileSchema,
  nullablePlayerReferenceSchema,
  playerRankedSummariesInputSchema,
  playerRankedSummariesSchema,
  playerReferenceByIdInputSchema,
  seasonStartsSchema,
} from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime } from '@brawltome/foundation'
import { createPostgresCareerPlayers } from '../career/postgres'
import { readRankedSummaries } from '../db/read-ranked-summaries'
import { readSeasonStarts } from '../db/read-season-starts'
import { createPostgresPlayerReferences } from '../player-references'
import { createPostgresRankedPlayers } from '../ranked/postgres'
import { createSeasonStartsCache } from '../ranked/season-starts-cache'
import { mapPlayerCareerProfile } from './map-career-profile'
import { mapPlayerRankedProfile } from './map-ranked-profile'

/** The player reads the API serves under player, at /rpc/player/* and /v1. Only internal callers get them. */
export function createPlayerProcedures(runtime: ModuleRuntime) {
  const { database } = runtime
  const references = createPostgresPlayerReferences(database)
  const career = createPostgresCareerPlayers(database)

  const ranked = createPostgresRankedPlayers(database, {
    resolveCareerMainLegend: (brawlhallaId) => career.mainLegendById(brawlhallaId),
  })

  const cachedSeasonStarts = createSeasonStartsCache(() => readSeasonStarts(database))

  const rankedSummaries = internalProcedure
    .route({
      method: 'POST',
      path: '/players/ranked-summaries',
      operationId: 'player.rankedSummaries',
      summary: 'Ranked summaries of several players',
      tags: ['player'],
    })
    .input(playerRankedSummariesInputSchema)
    .output(playerRankedSummariesSchema)
    .handler(({ input }) => readRankedSummaries(database, input.ids))

  const referenceById = internalProcedure
    .route({
      method: 'GET',
      path: '/players/{id}/reference',
      operationId: 'player.referenceById',
      summary: 'Name and aliases of a player',
      tags: ['player'],
    })
    .input(playerReferenceByIdInputSchema)
    .output(nullablePlayerReferenceSchema)
    .handler(({ input }) => references.byId(input.id))

  const rankedById = internalProcedure
    .route({
      method: 'GET',
      path: '/players/{id}/ranked',
      operationId: 'player.rankedById',
      summary: 'Ranked profile of a player',
      tags: ['player'],
    })
    .input(playerReferenceByIdInputSchema)
    .output(nullablePlayerRankedProfileSchema)
    .handler(async ({ input }) => mapPlayerRankedProfile(await ranked.byId(input.id)))

  const careerById = internalProcedure
    .route({
      method: 'GET',
      path: '/players/{id}/career',
      operationId: 'player.careerById',
      summary: 'Career profile of a player',
      tags: ['player'],
    })
    .input(playerReferenceByIdInputSchema)
    .output(nullablePlayerCareerProfileSchema)
    .handler(async ({ input }) => mapPlayerCareerProfile(await career.byId(input.id)))

  const seasonStarts = internalProcedure
    .route({
      method: 'GET',
      path: '/seasons',
      operationId: 'player.seasonStarts',
      summary: 'Start of every known ranked season',
      tags: ['player'],
    })
    .output(seasonStartsSchema)
    .handler(() => cachedSeasonStarts())

  return { rankedSummaries, referenceById, rankedById, careerById, seasonStarts }
}
