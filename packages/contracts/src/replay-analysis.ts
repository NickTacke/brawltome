import { z } from './zod'

export const REPLAY_UPLOAD_LIMIT_BYTES = 16 * 1024 * 1024
export const NATIVE_EXTENSION_URI =
  'https://github.com/NickTacke/brawlhalla-replay-processor/extensions/native' as const
export const MATCH_SUMMARY_EXTENSION_URI =
  'https://github.com/NickTacke/brawlhalla-replay-processor/extensions/match-summary' as const

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const nonnegativeSchema = z.number().nonnegative()
const identifierSchema = z.number().int().nonnegative()
const nullableMetricSchema = nonnegativeSchema.nullable()
const nullableShareSchema = z.number().min(0).max(1).nullable()
const replayTimestampSchema = z
  .number()
  .min(0)
  .max(3 * 60 * 60 * 1000)

const limitationSchema = z
  .object({
    code: z.string().min(1),
    scopes: z.array(z.string().startsWith('/')),
    text: z.string().min(1),
  })
  .strict()

const loadoutSchema = z
  .object({
    colorId: identifierSchema,
    costumeId: identifierSchema,
    koEffectId: identifierSchema,
    legendId: identifierSchema,
    morphWeapon2: z.boolean(),
    sidekickId: identifierSchema,
    stanceId: identifierSchema,
    weaponSkin1Id: identifierSchema,
    weaponSkin2Id: identifierSchema,
  })
  .strict()

const replayPlayerSchema = z
  .object({
    entityId: z.number().int().min(0).max(31),
    loadout: loadoutSchema,
    name: z.string().min(1).max(1024),
    playerId: identifierSchema.nullable(),
    score: z.number().int(),
    slot: identifierSchema,
    teamId: identifierSchema,
  })
  .strict()

const koEventSchema = z
  .object({
    victimSlot: identifierSchema,
    scoringSlot: identifierSchema.nullable(),
    timestampMs: replayTimestampSchema,
  })
  .strict()

const nativeMetricFields = {
  airDodges: nonnegativeSchema,
  airJumps: nonnegativeSchema,
  airTimeMs: nonnegativeSchema,
  clashes: nonnegativeSchema,
  damageDealt: nonnegativeSchema,
  damageTaken: nonnegativeSchema,
  dashes: nonnegativeSchema,
  dashJumps: nonnegativeSchema,
  deaths: nonnegativeSchema,
  dodges: nonnegativeSchema,
  groundTimeMs: nonnegativeSchema,
  jumps: nonnegativeSchema,
  kos: nonnegativeSchema,
  suicides: nonnegativeSchema,
  teamDamageDealt: nonnegativeSchema,
  teamDamageTaken: nonnegativeSchema,
  teamKos: nonnegativeSchema,
  wallTimeMs: nonnegativeSchema,
}

const nativePlayerMetricsSchema = z.object({ slot: identifierSchema, ...nativeMetricFields }).strict()

const analysisCoreSchema = z
  .object({
    limitations: z.array(limitationSchema).min(1),
    native: z.object({ players: z.array(nativePlayerMetricsSchema).min(2) }).strict(),
    provenance: z
      .object({
        collector: z.string().min(1),
        gameBuild: z.string().min(1),
        parityClaim: z.literal('replay-deterministic'),
        patchDigest: digestSchema,
        patchId: z.string().min(1),
        patchedArtifactDigest: digestSchema,
        pristineArtifactDigest: digestSchema,
        processorArtifactDigest: digestSchema,
        processorVersion: z.string().min(1),
        qualificationManifestDigest: digestSchema,
        qualificationProfile: z.string().min(1),
        replaySourceDigest: digestSchema,
      })
      .strict(),
    replay: z
      .object({
        durationMs: z
          .number()
          .min(1)
          .max(3 * 60 * 60 * 1000),
        format: z.literal(268),
        koTimeline: z.array(koEventSchema).max(4096),
        mapId: identifierSchema,
        matchSettings: z
          .object({ lives: z.number().int().min(1), scoreToWin: identifierSchema, teamMode: z.boolean() })
          .strict(),
        online: z.boolean(),
        outcome: z.object({ winningTeamId: identifierSchema.nullable() }).strict(),
        players: z.array(replayPlayerSchema).min(2).max(16),
        playlistId: identifierSchema,
        randomSeed: identifierSchema,
        replayDigest: digestSchema,
        teamScores: z.array(z.object({ score: z.number().int(), teamId: identifierSchema }).strict()).max(16),
      })
      .strict(),
  })
  .strict()

const extensionIdentityFields = {
  inputCoreDigest: digestSchema,
  inputCoreSchemaVersion: z.literal(1),
  limitations: z.array(limitationSchema),
  producerArtifactDigest: digestSchema,
  producerUri: z.string().startsWith('https://'),
  producerVersion: z.string().min(1),
  qualificationManifestDigest: digestSchema,
  schemaVersion: z.literal(1),
}

const powerCountersSchema = z
  .object({
    EnemyDamage: nonnegativeSchema,
    EnemyHits: nonnegativeSchema,
    EnemyKOs: nonnegativeSchema,
    TeamDamage: nonnegativeSchema,
    TeamHits: nonnegativeSchema,
    Uses: nonnegativeSchema,
  })
  .passthrough()

const equipmentCountersSchema = z
  .object({
    Powers: z.record(z.string().min(1), powerCountersSchema).optional(),
    TimeHeld: nonnegativeSchema,
  })
  .passthrough()

const nativePayloadSchema = z
  .object({
    Equipment: z.record(z.string().min(1), equipmentCountersSchema).refine((value) => Object.keys(value).length > 0),
    Sequence: z.array(z.unknown()),
  })
  .passthrough()

const nativeExtensionSchema = z
  .object({
    ...extensionIdentityFields,
    data: z
      .object({
        players: z.array(z.object({ payload: nativePayloadSchema, slot: identifierSchema }).strict()).min(2),
      })
      .strict(),
  })
  .strict()

const playerSummarySchema = z
  .object({
    airDodgeShare: nullableShareSchema,
    airJumpShare: nullableShareSchema,
    airTimeShare: nullableShareSchema,
    damageDealtPerKo: nullableMetricSchema,
    damageDealtPerMinute: nullableMetricSchema,
    damageTakenPerDeath: nullableMetricSchema,
    damageTakenPerMinute: nullableMetricSchema,
    dashesPerMinute: nullableMetricSchema,
    dashJumpShare: nullableShareSchema,
    deathsPerMinute: nullableMetricSchema,
    dodgesPerMinute: nullableMetricSchema,
    friendlyDamageDealtShare: nullableShareSchema,
    friendlyDamageTakenShare: nullableShareSchema,
    groundTimeShare: nullableShareSchema,
    jumpsPerMinute: nullableMetricSchema,
    koDeathRatio: nullableMetricSchema,
    kosPerMinute: nullableMetricSchema,
    slot: identifierSchema,
    wallTimeShare: nullableShareSchema,
  })
  .strict()

const matchSummaryExtensionSchema = z
  .object({
    ...extensionIdentityFields,
    data: z
      .object({
        equipment: z.array(
          z
            .object({
              heldTimeShare: nullableShareSchema,
              key: z.string().min(1),
              slot: identifierSchema,
              sourcePointer: z.string().startsWith('/'),
            })
            .strict(),
        ),
        players: z.array(playerSummarySchema).min(2),
        powers: z.array(
          z
            .object({
              enemyDamagePerHit: nullableMetricSchema,
              enemyDamagePerUse: nullableMetricSchema,
              enemyHitsPerUse: nullableMetricSchema,
              enemyKosPerUse: nullableMetricSchema,
              key: z.string().min(1),
              slot: identifierSchema,
              sourcePointer: z.string().startsWith('/'),
              teamDamagePerUse: nullableMetricSchema,
              teamHitsPerUse: nullableMetricSchema,
            })
            .strict(),
        ),
        rateDenominatorMs: nonnegativeSchema,
      })
      .strict(),
  })
  .strict()

export const analysisResultV1Schema = z
  .object({
    core: analysisCoreSchema,
    coreDigest: digestSchema,
    extensions: z
      .object({
        [NATIVE_EXTENSION_URI]: nativeExtensionSchema,
        [MATCH_SUMMARY_EXTENSION_URI]: matchSummaryExtensionSchema.optional(),
      })
      .catchall(z.unknown()),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine(({ extensions }, context) => {
    for (const key of Object.keys(extensions)) {
      if (!key.startsWith('https://')) {
        context.addIssue({ code: 'custom', message: 'Extension keys must be HTTPS URIs', path: ['extensions', key] })
      }
    }
  })

export const replayJobStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed'])
export const replayJobFailureSchema = z.object({ code: z.string().min(1), message: z.string().min(1) }).strict()
export const replayJobSummarySchema = z
  .object({
    id: z.string().uuid(),
    status: replayJobStatusSchema,
    fileName: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    failure: replayJobFailureSchema.nullable(),
  })
  .strict()
export const replayJobDetailSchema = replayJobSummarySchema
  .extend({ result: analysisResultV1Schema.nullable() })
  .strict()

export type AnalysisResultV1 = z.infer<typeof analysisResultV1Schema>
export type ReplayJobSummaryContract = z.infer<typeof replayJobSummarySchema>
export type ReplayJobDetailContract = z.infer<typeof replayJobDetailSchema>
