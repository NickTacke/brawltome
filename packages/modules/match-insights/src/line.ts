import { z } from 'zod'

// the part of a stored bh-native line (format 1) the analysis reads, with the timeline typed instead of opaque.
// events of a type the analysis doesn't know are left out, so a newer bh-native adding one doesn't break the page

const step = z.number().int()
const slot = z.number().int().min(1)

function seriesOf<Value extends z.ZodType>(value: Value) {
  return z.array(z.tuple([step, value]))
}

const named = z.object({ id: z.number().int(), name: z.string() })

const linePlayerSchema = z.object({
  slot,
  brawlhallaId: z.number().int(),
  name: z.string(),
  team: z.number().int(),
  legend: named,
})

const matchSchema = z.object({
  map: named,
  rules: z.object({
    mode: named,
    queue: z.string().nullable().optional(),
    isRanked: z.boolean(),
    hasTeams: z.boolean(),
    stocks: z.number().int().nullable().optional(),
  }),
  players: z.array(linePlayerSchema).min(1),
})

const attackEventSchema = z.object({
  step,
  type: z.literal('attack'),
  player: slot,
  move: z.string(),
  weapon: z.string(),
  signature: z.boolean(),
  air: z.boolean(),
})

const hitEventSchema = z.object({
  step,
  type: z.literal('hit'),
  attacker: slot,
  target: slot,
  move: z.string(),
  weapon: z.string(),
  damage: z.number(),
  x: z.number(),
  y: z.number(),
})

// no killer when the player went out on their own
const koEventSchema = z.object({
  step,
  type: z.literal('ko'),
  player: slot,
  killer: slot.nullable(),
  damage: z.number(),
})

// the direction is empty for a dodge on the spot; a kind starting with Fast is the chase dodge after landing a hit
const dodgeEventSchema = z.object({
  step,
  type: z.literal('dodge'),
  player: slot,
  kind: z.string(),
  direction: z.string(),
})

const movementEventSchema = z.object({
  step,
  type: z.enum(['jump', 'dash', 'pickup', 'throw', 'drop', 'respawn']),
  player: slot,
})

const eventSchema = z.union([attackEventSchema, hitEventSchema, koEventSchema, dodgeEventSchema, movementEventSchema])

const knownEventTypes = new Set(['attack', 'hit', 'ko', 'dodge', 'jump', 'dash', 'pickup', 'throw', 'drop', 'respawn'])

function isKnownEvent(event: unknown): boolean {
  return typeof event === 'object' && event !== null && knownEventTypes.has(String((event as { type?: unknown }).type))
}

const eventsSchema = z.preprocess(
  (events) => (Array.isArray(events) ? events.filter(isKnownEvent) : events),
  z.array(eventSchema),
)

const playerStateSchema = z.object({
  damage: seriesOf(z.number()),
  status: seriesOf(z.string()),
  inAir: seriesOf(z.boolean()),
  onWall: seriesOf(z.boolean()),
  weapon: seriesOf(z.string()),
  move: seriesOf(z.string()),
  hitstun: seriesOf(z.boolean()),
  dodging: seriesOf(z.boolean()),
  airJumpsUsed: seriesOf(z.number().int()),
  input: seriesOf(z.number().int()),
})

// one position sample every `every` steps, from step `from`
const trackSchema = z.object({ from: step, x: z.array(z.number()), y: z.array(z.number()) })

const timelineSchema = z.object({
  stepMs: z.number().int().positive(),
  startStep: step,
  endStep: step,
  // the names of the animations the state's indices point at, in the lines that record them
  animations: z.array(z.unknown()).optional(),
  events: eventsSchema,
  state: z.record(z.string(), playerStateSchema),
  positions: z.object({ every: z.number().int().positive() }).catchall(trackSchema),
})

export const lineSchema = z.object({
  patch: z.string(),
  format: z.literal(1),
  stats: z.object({ GameDuration: z.number().int().nonnegative() }).catchall(z.unknown()),
  match: matchSchema,
  reliability: z.object({ isReliable: z.boolean() }),
  timeline: timelineSchema,
})

// enough of a line to tell what kind of match it was, without reading its timeline
export const lineHeadSchema = z.object({
  format: z.literal(1),
  match: matchSchema,
  timeline: z.object({ events: z.array(z.unknown()) }),
})

export type Line = z.infer<typeof lineSchema>
export type LineHead = z.infer<typeof lineHeadSchema>
export type LinePlayer = z.infer<typeof linePlayerSchema>
export type LineEvent = z.infer<typeof eventSchema>
export type AttackEvent = z.infer<typeof attackEventSchema>
export type HitEvent = z.infer<typeof hitEventSchema>
export type KoEvent = z.infer<typeof koEventSchema>
export type DodgeEvent = z.infer<typeof dodgeEventSchema>
export type PlayerState = z.infer<typeof playerStateSchema>
export type Track = z.infer<typeof trackSchema>
export type Series<Value> = [number, Value][]
