import {
  type ClanProfileContract,
  type ClanStandingContract,
  clanProfileSchema,
  clanStandingSchema,
  type PlayerRankedSummaryContract,
  playerRankedSummariesSchema,
} from '@brawltome/contracts'
import { postApi, readApi } from './api'

export type GuildPage = {
  clan: ClanProfileContract
  standing: ClanStandingContract | null
  summaries: PlayerRankedSummaryContract[]
  // false when a batch failed, statistics from part of a roster would look complete and be wrong
  hasAllSummaries: boolean
  // one clock for anything that depends on the time, so the server render and hydration can't disagree
  loadedAt: string
}

// the most ids the ranked summaries read accepts in one request
const summaryBatchSize = 250

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown failure'
}

export function batchIds(ids: number[], batchSize = summaryBatchSize): number[][] {
  const batches: number[][] = []

  for (let start = 0; start < ids.length; start += batchSize) batches.push(ids.slice(start, start + batchSize))

  return batches
}

// thrown messages reach the page's html, so the detail only goes to the server log
async function readProfile(guildId: number): Promise<ClanProfileContract | null> {
  try {
    return await readApi(`/clans/${guildId}`, clanProfileSchema.nullable(), `load guild ${guildId}`)
  } catch (error) {
    console.error(failureText(error))

    throw new Error(`load guild ${guildId}: the guild could not be read`)
  }
}

// a short limit, so a slow optional read can't double how long the visitor waits for numbers that only decorate the page
const optionalRead = { timeoutMs: 3_000 }

// these numbers only decorate the roster, so the page is still worth showing without them
async function readOptional<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch (error) {
    console.error(failureText(error))

    return fallback
  }
}

function readStanding(guildId: number): Promise<ClanStandingContract | null> {
  const description = `load standing for guild ${guildId}`

  return readOptional(
    () => readApi(`/clans/${guildId}/standing`, clanStandingSchema.nullable(), description, optionalRead),
    null,
  )
}

type SummaryResult = { summaries: PlayerRankedSummaryContract[]; hasAllSummaries: boolean }

async function readSummaries(guildId: number, memberIds: number[]): Promise<SummaryResult> {
  const description = `load ranked summaries for guild ${guildId}`

  const batches = batchIds(memberIds).map((ids) =>
    readOptional(
      () => postApi('/players/ranked-summaries', { ids }, playerRankedSummariesSchema, description, optionalRead),
      null,
    ),
  )

  const answers = await Promise.all(batches)

  return {
    summaries: answers.flatMap((answer) => answer ?? []),
    hasAllSummaries: answers.every((answer) => answer !== null),
  }
}

export async function loadGuild(guildId: number): Promise<GuildPage | null> {
  const clan = await readProfile(guildId)

  if (!clan) return null

  const memberIds = clan.members.map((member) => member.brawlhallaId)

  const [standing, { summaries, hasAllSummaries }] = await Promise.all([
    readStanding(guildId),
    readSummaries(guildId, memberIds),
  ])

  return { clan, standing, summaries, hasAllSummaries, loadedAt: new Date().toISOString() }
}
