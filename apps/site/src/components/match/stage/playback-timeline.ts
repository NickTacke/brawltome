import type { Timeline } from '@brawltome/replay-player'
import { z } from 'zod'

// the timeline the site serves for playing a match back (the replays module's trimmed timeline), read into the shape
// @brawltome/replay-player draws from. a timeline of another shape is refused, and the page plays without legends

const playbackSchema = z.object({
  stepMs: z.number().positive(),
  startStep: z.number().int(),
  endStep: z.number().int(),
  stepZeroTime: z.number().nullable(),
  animations: z.array(z.tuple([z.string(), z.string()])),
  objectAnimations: z.array(z.tuple([z.string(), z.string()])),
  objects: z.array(z.unknown()),
  positions: z.object({ every: z.number().positive() }).catchall(z.unknown()),
  state: z.record(z.string(), z.record(z.string(), z.unknown())),
})

/** Reads a fetched playback timeline; throws when it isn't one. */
export function readPlaybackTimeline(value: unknown): Timeline {
  const parsed = playbackSchema.safeParse(value)

  if (!parsed.success) throw new Error(`read playback timeline: ${parsed.error.message}`)

  const { stepZeroTime, ...timeline } = parsed.data

  // the player tints players only in a line whose clock at step 0 is known, and tells that by the field being there
  const read = stepZeroTime === null ? timeline : { ...timeline, stepZeroTime }

  return read as unknown as Timeline
}

/** Fetches and reads a match's playback timeline from the site; the browser unpacks the gzip itself. */
export async function fetchPlaybackTimeline(path: string, signal: AbortSignal): Promise<Timeline> {
  const response = await fetch(path, { signal })

  if (!response.ok) throw new Error(`load playback timeline ${path}: HTTP ${response.status}`)

  return readPlaybackTimeline(await response.json())
}

/** The timeline's step at a time of the page's clock, which counts from the match's first step; fractional between steps. */
export function stepAt(timeline: Timeline, timeMs: number): number {
  return timeline.startStep + timeMs / (timeline.stepMs ?? 16)
}
