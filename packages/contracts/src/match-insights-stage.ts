import { z } from './zod'

// the match drawn on its stage. every coordinate is a share of the stage box: 0,0 is its top left, 1,1 its bottom
// right; a spot outside the box sits on its edge, except in playback, where a launched player keeps flying

const slot = z.number().int().min(1)
const timeMs = z.number().int().nonnegative()

// [ms, value from then on]
function changesOf<Value extends z.ZodType>(value: Value) {
  return z.array(z.tuple([z.number().int(), value]))
}

const stageSegmentSchema = z
  .object({ fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number(), isSoft: z.boolean() })
  .strict()

const stageRectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict()

const stageArtSchema = stageRectSchema.extend({ file: z.string(), rotation: z.number() }).strict()

// the level coordinates the shares are measured against
const stageBoxSchema = z.object({ minX: z.number(), minY: z.number(), width: z.number(), height: z.number() }).strict()

const stageHitSchema = z
  .object({
    timeMs,
    x: z.number(),
    y: z.number(),
    attacker: slot,
    target: slot,
    weapon: z.string(),
    move: z.string(),
    damage: z.number(),
    // the punish the hit belongs to, as an index into the match's punishes
    punishIndex: z.number().int().nonnegative().nullable(),
  })
  .strict()

const stageKoSchema = z.object({ timeMs, victim: slot, x: z.number(), y: z.number() }).strict()

// [ms, x, y]
const stageSpotSchema = z.tuple([timeMs, z.number(), z.number()])

const stageTrailSchema = z.object({ slot, spots: z.array(stageSpotSchema) }).strict()

const stageMarksSchema = z
  .object({
    hits: z.array(stageHitSchema),
    kos: z.array(stageKoSchema),
    tracks: z.array(stageTrailSchema),
    dodges: z.array(stageTrailSchema),
  })
  .strict()

// [animation index, first frame, frames per step]; null while the player shows no animation
const animationShownSchema = z.tuple([z.number().int(), z.number(), z.number()]).nullable()

const playbackPlayerSchema = z
  .object({
    slot,
    // one entry per position sample, from the start of the match
    x: z.array(z.number()),
    y: z.array(z.number()),
    isLive: changesOf(z.boolean()),
    facingRight: changesOf(z.boolean()),
    weapon: changesOf(z.string()),
    move: changesOf(z.string()),
    damage: changesOf(z.number()),
    stocksLeft: changesOf(z.number().int()),
    isInAir: changesOf(z.boolean()),
    isHitstun: changesOf(z.boolean()),
    isDodging: changesOf(z.boolean()),
    // empty when the line records no animations. the times are not clamped to the match start, so the frame shown
    // can be counted from when an animation began
    animation: changesOf(animationShownSchema),
  })
  .strict()

const playbackSchema = z
  .object({
    sampleMs: z.number().int().positive(),
    stepMs: z.number().int().positive(),
    durationMs: timeMs,
    players: z.array(playbackPlayerSchema),
    // the replay's file name without its extension
    replay: z.string(),
    hasAnimations: z.boolean(),
    box: stageBoxSchema,
  })
  .strict()

export const stageSchema = z
  .object({
    // the map's background, when its layout is known
    background: z.string().nullable(),
    // the part of the box the game's camera shows; the whole box without a layout
    camera: stageRectSchema,
    // width over height of the box
    aspect: z.number().positive(),
    // ground and walls from the layout's collision lines; none without a layout
    segments: z.array(stageSegmentSchema),
    art: z.array(stageArtSchema),
    // the box was traced around where players stood, as the map's layout wasn't known
    isTraced: z.boolean(),
    marks: stageMarksSchema,
    playback: playbackSchema,
  })
  .strict()

export type StageSegment = z.infer<typeof stageSegmentSchema>
export type StageRect = z.infer<typeof stageRectSchema>
export type StageArt = z.infer<typeof stageArtSchema>
export type StageBox = z.infer<typeof stageBoxSchema>
export type StageHit = z.infer<typeof stageHitSchema>
export type StageKo = z.infer<typeof stageKoSchema>
export type StageSpot = z.infer<typeof stageSpotSchema>
export type StageTrail = z.infer<typeof stageTrailSchema>
export type StageMarks = z.infer<typeof stageMarksSchema>
export type AnimationShown = z.infer<typeof animationShownSchema>
export type PlaybackPlayer = z.infer<typeof playbackPlayerSchema>
export type Playback = z.infer<typeof playbackSchema>
export type Stage = z.infer<typeof stageSchema>
