import { isInsightMatch } from '@brawltome/match-insights'
import { z } from 'zod'
import { playbackKey } from './keys'
import { findMatchRow } from './match-row'
import type { ReplaysDeps } from './model'
import { gzipJson, readStoredLine } from './stored-json'

// the part of a line's timeline the match page plays a match back from: the clock, the legends' animations and
// positions, the game's objects, and the state each player is drawn with. about a fifth of the line; the events and
// the rest of the state are already worked into the insights

// the animation shown, which way the player faces, what they hold, their status (which the camera frames them by),
// their damage and stocks left, and what the game tints them by: hits, dodges, respawns and air jumps
const drawnState = [
  'animation',
  'facingRight',
  'weapon',
  'status',
  'damage',
  'stocks',
  'airJumpsUsed',
  'hitstun',
  'dodging',
  'invulnerable',
  'afterRespawn',
  'lastHit',
] as const

type DrawnState = Partial<Record<(typeof drawnState)[number], unknown>>

// a line from before bh-native recorded animations has none of them, and is still played back with tokens
const timelineSchema = z.object({
  stepMs: z.number().positive(),
  startStep: z.number().int(),
  endStep: z.number().int(),
  stepZeroTime: z.number().optional(),
  animations: z.array(z.unknown()).default([]),
  objectAnimations: z.array(z.unknown()).default([]),
  objects: z.array(z.unknown()).default([]),
  positions: z.record(z.string(), z.unknown()),
  state: z.record(z.string(), z.record(z.string(), z.unknown())),
})

export type PlaybackTimeline = Omit<z.infer<typeof timelineSchema>, 'stepZeroTime' | 'state'> & {
  stepZeroTime: number | null
  state: Record<string, DrawnState>
}

function drawnStateOf(state: Record<string, unknown>): DrawnState {
  const kept = drawnState.filter((key) => key in state)

  return Object.fromEntries(kept.map((key) => [key, state[key]]))
}

/** Keeps what playing the match back reads from a line's timeline; throws when the line has no timeline. */
export function trimPlaybackTimeline(line: unknown): PlaybackTimeline {
  const parsed = z.object({ timeline: timelineSchema }).safeParse(line)

  if (!parsed.success) throw new Error(`trim playback timeline: the line has no timeline: ${parsed.error.message}`)

  const { stepZeroTime, state, ...timeline } = parsed.data.timeline
  const slots = Object.entries(state).map(([slot, slotState]) => [slot, drawnStateOf(slotState)])

  return { ...timeline, stepZeroTime: stepZeroTime ?? null, state: Object.fromEntries(slots) }
}

/**
 * A match's playback timeline, gzipped, trimmed from its line on the first read. Null when the match wasn't parsed
 * with that build, or isn't one the page plays back.
 */
export async function readPlaybackFor(
  deps: Pick<ReplaysDeps, 'database' | 'objectStore'>,
  matchId: string,
  build: string,
): Promise<Uint8Array | null> {
  const match = await findMatchRow(deps.database.sql, matchId)

  if (!match?.timelineKey || match.build !== build) return null

  const key = playbackKey(match.id, build)
  const stored = await deps.objectStore.get(key)

  if (stored) return stored

  const line = await readStoredLine(deps.objectStore, match.timelineKey)

  if (!isInsightMatch(line)) return null

  const bytes = gzipJson(trimPlaybackTimeline(line))

  await deps.objectStore.put(key, bytes, 'application/gzip')

  return bytes
}
