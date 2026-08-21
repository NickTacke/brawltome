import { describe, expect, test } from 'bun:test'
import {
  EVENT_TIMELINE_EXTENSION_URI,
  NATIVE_EXTENSION_URI,
  analysisResultV1Schema,
  eventTimelineExtensionSchema,
} from '../src/replay-analysis'

const digest = `sha256:${'a'.repeat(64)}`
const identity = {
  inputCoreDigest: digest,
  inputCoreSchemaVersion: 1,
  limitations: [],
  producerArtifactDigest: digest,
  producerUri: EVENT_TIMELINE_EXTENSION_URI,
  producerVersion: 'test',
  qualificationManifestDigest: digest,
  schemaVersion: 1,
}
const eventTimeline = {
  ...identity,
  data: {
    clock: { basis: 'native-replay', quantumMs: 16, replayOffsetMs: 6016 },
    players: [
      {
        slot: 0,
        dodges: [{ airborne: false, sequence: 0, timestampMs: 6032, x: 1, y: 0 }],
        moves: [
          {
            equipmentKey: 'Sword',
            gravityCancelled: false,
            powerKey: 'nLight',
            sequence: 1,
            timestampMs: 6048,
          },
        ],
        hits: [
          {
            damageApplied: 13.5,
            equipmentKey: 'Sword',
            knockout: false,
            moveSequence: 1,
            powerKey: 'nLight',
            sequence: 2,
            target: 'enemy',
            timestampMs: 6080,
            victimSlot: 1,
          },
        ],
      },
      { slot: 1, dodges: [], moves: [], hits: [] },
    ],
  },
}
const nativeMetrics = {
  airDodges: 0,
  airJumps: 0,
  airTimeMs: 0,
  clashes: 0,
  damageDealt: 0,
  damageTaken: 0,
  dashes: 0,
  dashJumps: 0,
  deaths: 0,
  dodges: 0,
  groundTimeMs: 1,
  jumps: 0,
  kos: 0,
  suicides: 0,
  teamDamageDealt: 0,
  teamDamageTaken: 0,
  teamKos: 0,
  wallTimeMs: 0,
}
const loadout = {
  colorId: 0,
  costumeId: 0,
  koEffectId: 0,
  legendId: 1,
  morphWeapon2: false,
  sidekickId: 0,
  stanceId: 0,
  weaponSkin1Id: 0,
  weaponSkin2Id: 0,
}

function analysisResult(format = 269) {
  return {
    schemaVersion: 1,
    coreDigest: digest,
    core: {
      limitations: [{ code: 'test', scopes: ['/'], text: 'Test limitation.' }],
      native: {
        players: [
          { slot: 0, ...nativeMetrics },
          { slot: 1, ...nativeMetrics },
        ],
      },
      provenance: {
        collector: 'test',
        gameBuild: '24744406',
        parityClaim: 'replay-deterministic',
        patchDigest: digest,
        patchId: 'test',
        patchedArtifactDigest: digest,
        pristineArtifactDigest: digest,
        processorArtifactDigest: digest,
        processorVersion: 'test',
        qualificationManifestDigest: digest,
        qualificationProfile: 'test',
        replaySourceDigest: digest,
      },
      replay: {
        durationMs: 1,
        format,
        koTimeline: [],
        mapId: 1,
        matchSettings: { lives: 3, scoreToWin: 0, teamMode: false },
        online: true,
        outcome: { winningTeamId: null },
        players: [
          { entityId: 0, loadout, name: 'One', playerId: null, score: 0, slot: 0, teamId: 0 },
          { entityId: 1, loadout, name: 'Two', playerId: null, score: 0, slot: 1, teamId: 1 },
        ],
        playlistId: 1,
        randomSeed: 1,
        replayDigest: digest,
        teamScores: [],
      },
    },
    extensions: {
      [NATIVE_EXTENSION_URI]: {
        ...identity,
        producerUri: NATIVE_EXTENSION_URI,
        data: {
          players: [
            { slot: 0, payload: { Equipment: { Sword: { TimeHeld: 1 } }, Sequence: [] } },
            { slot: 1, payload: { Equipment: { Sword: { TimeHeld: 1 } }, Sequence: [] } },
          ],
        },
      },
      [EVENT_TIMELINE_EXTENSION_URI]: structuredClone(eventTimeline),
    },
  }
}

describe('replay analysis contract', () => {
  test('accepts the strict event timeline extension', () => {
    const value = eventTimelineExtensionSchema.parse(eventTimeline)

    expect(value.data.players[0]?.hits[0]?.damageApplied).toBe(13.5)
  })

  test('rejects format 268 analysis results', () => {
    expect(analysisResultV1Schema.safeParse(analysisResult(268)).success).toBe(false)
  })

  test('rejects unknown fields on known event players', () => {
    const input = structuredClone(eventTimeline)
    const player = input.data.players[0]
    if (!player) throw new Error('event player fixture missing')
    Object.assign(player, { extra: true })

    expect(eventTimelineExtensionSchema.safeParse(input).success).toBe(false)
  })

  test('rejects event clocks with an invalid quantum', () => {
    const input = structuredClone(eventTimeline)
    input.data.clock.quantumMs = 17

    expect(eventTimelineExtensionSchema.safeParse(input).success).toBe(false)
  })

  test('rejects malformed known event extensions in analysis results', () => {
    const input = analysisResult()
    Object.assign(input.extensions[EVENT_TIMELINE_EXTENSION_URI], { data: { players: [] } })

    expect(analysisResultV1Schema.safeParse(input).success).toBe(false)
  })

  test('preserves unknown extension compatibility', () => {
    const input = analysisResult()
    Object.assign(input.extensions, { 'https://example.com/extensions/future': { future: true } })

    expect(analysisResultV1Schema.safeParse(input).success).toBe(true)
  })
})
