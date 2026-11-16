import { type LevelLayout, levelLayoutSchema, type MatchInsights } from '@brawltome/contracts'
import type { ObjectStore } from '@brawltome/foundation'
import { INSIGHTS_VERSION, readMatchInsights } from '@brawltome/match-insights'
import { z } from 'zod'
import { insightsKey } from './keys'
import { findMatchRow, type StoredMatchRow } from './match-row'
import type { ReplaysDeps } from './model'
import { gunzipJson, gzipJson, readStoredLine } from './stored-json'

// a match's insights are worked out from its stored line once, then kept in the private replays bucket. the key
// names the build, the version of the figures and the map layout, so a new one of any of them works them out again

type InsightsDeps = Pick<ReplaysDeps, 'database' | 'objectStore' | 'artStore'>

type InsightsMatch = Pick<StoredMatchRow, 'id' | 'build' | 'patch' | 'mapId' | 'timelineKey'>

type MapLayout = { path: string; layout: LevelLayout }

// the art export's map file; only its layout is read here
const mapFileSchema = z.object({ layout: levelLayoutSchema })

/**
 * A match's insights, worked out on the first read and again once they're stale. Null for a match the page isn't
 * designed for, or one without a stored line; throws when working them out fails.
 */
export async function readMatchInsightsFor(deps: InsightsDeps, matchId: string): Promise<MatchInsights | null> {
  const match = await findMatchRow(deps.database.sql, matchId)

  if (!match) return null

  return insightsOf(deps, match)
}

/** The same for a match already found. */
export async function insightsOf(deps: InsightsDeps, match: InsightsMatch): Promise<MatchInsights | null> {
  if (!match.timelineKey) return null

  const layoutPath = await layoutPathOf(deps, match)
  const stored = await storedInsights(deps.objectStore, match, layoutPath)

  if (stored !== 'missing') return stored

  const layout = layoutPath ? await readLayout(deps.artStore, layoutPath) : null

  // a map file that doesn't read is logged, and the match is read as if its map had no layout yet
  if (layoutPath && !layout) return insightsWithoutLayout(deps.objectStore, match, match.timelineKey)

  return workOutInsights(deps.objectStore, match, match.timelineKey, layout)
}

export function logInsightsFailure(matchId: string, error: unknown): void {
  console.error(`work out the insights of match ${matchId}:`, error)
}

// the map file the art export drew this match's map with, for its patch; none without an art bucket
async function layoutPathOf(deps: InsightsDeps, match: InsightsMatch): Promise<string | null> {
  if (!deps.artStore) return null

  const [mapFile] = await deps.database.sql<{ path: string }[]>`
    SELECT path FROM replays.map_files WHERE patch = ${match.patch} AND map_id = ${match.mapId}
  `

  return mapFile?.path ?? null
}

// stored null means the match was read and has no insights, so its line isn't read again on every visit
async function storedInsights(
  objectStore: ObjectStore,
  match: InsightsMatch,
  layoutPath: string | null,
): Promise<MatchInsights | null | 'missing'> {
  const bytes = await objectStore.get(insightsKey(match.id, match.build, INSIGHTS_VERSION, layoutPath))

  if (!bytes) return 'missing'

  return gunzipJson(bytes) as MatchInsights | null
}

type MapFileRead = { layout: LevelLayout } | { reason: string }

// a map file that's missing, doesn't read, or that the art bucket fails to hand over is logged, and the match is read
// without a layout
async function readLayout(artStore: ObjectStore | null, path: string): Promise<MapLayout | null> {
  const mapFile = await readMapFile(artStore, path)

  if ('layout' in mapFile) return { path, layout: mapFile.layout }

  console.error(`read the layout in map file ${path}: ${mapFile.reason}`)

  return null
}

async function readMapFile(artStore: ObjectStore | null, path: string): Promise<MapFileRead> {
  const bytes = await artStore?.get(path).catch((error: unknown) => new Error(String(error)))

  if (bytes instanceof Error) return { reason: `the art bucket failed: ${bytes.message}` }

  if (!bytes) return { reason: 'the art bucket has no such file' }

  const mapFile = mapFileSchema.safeParse(parseJson(bytes))

  return mapFile.success ? { layout: mapFile.data.layout } : { reason: mapFile.error.message }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}

async function insightsWithoutLayout(
  objectStore: ObjectStore,
  match: InsightsMatch,
  timelineKey: string,
): Promise<MatchInsights | null> {
  const stored = await storedInsights(objectStore, match, null)

  if (stored !== 'missing') return stored

  return workOutInsights(objectStore, match, timelineKey, null)
}

async function workOutInsights(
  objectStore: ObjectStore,
  match: InsightsMatch,
  timelineKey: string,
  layout: MapLayout | null,
): Promise<MatchInsights | null> {
  const line = await readStoredLine(objectStore, timelineKey)
  const insights = readMatchInsights(line, layout?.layout ?? null)
  const key = insightsKey(match.id, match.build, INSIGHTS_VERSION, layout?.path ?? null)

  await objectStore.put(key, gzipJson(insights), 'application/gzip')

  return insights
}
