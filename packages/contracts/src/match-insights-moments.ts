import { z } from './zod'

// the exchanges of a match: every punish, every KO, and the moments a review steps through

const count = z.number().int().nonnegative()
const slot = z.number().int().min(1)
const timeMs = z.number().int().nonnegative()
const step = z.number().int()

export const punishCauses = ['whiff', 'dodge', 'stuffed', 'landing', 'trade', 'reversal', 'throw', 'clean'] as const

const punishHitSchema = z
  .object({
    offsetMs: timeMs,
    weapon: z.string(),
    move: z.string(),
    damage: z.number(),
    // the target was still stunned from the hit before, so there was nothing they could do
    isTrue: z.boolean(),
  })
  .strict()

// an opening and the hits that followed it, until the hits stopped, the target was KO'd or hit back
const punishSchema = z
  .object({
    attacker: slot,
    target: slot,
    startStep: step,
    endStep: step,
    startMs: timeMs,
    endMs: timeMs,
    cause: z.enum(punishCauses),
    hits: z.array(punishHitSchema),
    damage: z.number(),
    targetDamageFrom: z.number(),
    targetDamageTo: z.number(),
    isKo: z.boolean(),
    wasReversed: z.boolean(),
  })
  .strict()

const knockoutSchema = z
  .object({
    timeMs,
    victim: slot,
    killer: slot.nullable(),
    // a teammate's hit sent them out, which no punish records: those are between enemies
    isByTeammate: z.boolean(),
    damage: z.number(),
    move: z.string().nullable(),
    weapon: z.string().nullable(),
    zone: z.enum(['side', 'top', 'bottom']),
    // index into the match's punishes, when a hit led to the KO
    punishIndex: count.nullable(),
    sinceOpeningMs: timeMs.nullable(),
    airJumpsUsed: count,
    wasAirborne: z.boolean(),
  })
  .strict()

export const leadKinds = ['throw', 'trade', 'whiff', 'swing', 'dodge', 'landing', 'free'] as const

// what the target was doing when the first hit of a punish landed
const leadSchema = z
  .object({
    kind: z.enum(leadKinds),
    // the target's own move, dodge direction or last movement the lead is about
    action: z.string().nullable(),
    // how long before the first hit that action began; for a trade, the gap between the two hits
    beforeMs: timeMs.nullable(),
    wasInAir: z.boolean(),
    // how long before the first hit the attacker started the move that landed
    attackBeforeMs: timeMs.nullable(),
  })
  .strict()

export const momentClasses = ['team-ko', 'fall', 'early-ko', 'ko', 'big', ...leadKinds] as const

// the weapon is the game's own name for it, for its icon; the name is the move alone, the move both together
const momentHitSchema = z
  .object({ weapon: z.string(), name: z.string(), move: z.string(), damage: z.number() })
  .strict()

const momentSchema = z
  .object({
    key: z.string(),
    // what it cost first, then how it began
    class: z.enum(momentClasses),
    // the first hit, or the KO when no hit led to it
    timeMs,
    endMs: timeMs,
    attacker: slot.nullable(),
    victim: slot,
    damage: z.number(),
    hits: z.array(momentHitSchema),
    knockout: knockoutSchema.nullable(),
    // nothing for a KO without a hit
    lead: leadSchema.nullable(),
    // where the first hit landed, as a share of the stage box
    spot: z.object({ x: z.number(), y: z.number() }).strict().nullable(),
  })
  .strict()

// a dodge or a weapon throw, for the lanes of the replay's timeline
const playerActionSchema = z.object({ slot, timeMs, type: z.enum(['dodge', 'throw']) }).strict()

export const reviewScopes = ['key', 'taken', 'dealt', 'kos'] as const

// one moment a review of one player's match stops at: key moments are their KOs and big punishes either way
const reviewStopSchema = z.object({ slot, scope: z.enum(reviewScopes), momentKey: z.string(), timeMs }).strict()

export { knockoutSchema, momentSchema, playerActionSchema, punishSchema, reviewStopSchema }

export type PunishCause = (typeof punishCauses)[number]
export type PunishHit = z.infer<typeof punishHitSchema>
export type Punish = z.infer<typeof punishSchema>
export type Knockout = z.infer<typeof knockoutSchema>
export type KoZone = Knockout['zone']
export type LeadKind = (typeof leadKinds)[number]
export type Lead = z.infer<typeof leadSchema>
export type MomentClass = (typeof momentClasses)[number]
export type MomentHit = z.infer<typeof momentHitSchema>
export type Moment = z.infer<typeof momentSchema>
export type PlayerAction = z.infer<typeof playerActionSchema>
export type ReviewScope = (typeof reviewScopes)[number]
export type ReviewStop = z.infer<typeof reviewStopSchema>
