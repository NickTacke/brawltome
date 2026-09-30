import { describe, expect, test } from 'bun:test'
import { buildReplayReport, formatCount, formatRate } from '@/app/matches/replay-report'
import { MATCH_SUMMARY_EXTENSION_URI, NATIVE_EXTENSION_URI, type ReplayJobDetailContract } from '@brawltome/contracts'

const digest = `sha256:${'a'.repeat(64)}`

function identity() {
  return {
    inputCoreDigest: digest,
    inputCoreSchemaVersion: 1 as const,
    limitations: [{ code: 'replay-not-live', scopes: ['/'], text: 'Replay deterministic.' }],
    producerArtifactDigest: digest,
    producerUri: 'https://example.test/producer',
    producerVersion: 'test',
    qualificationManifestDigest: digest,
    schemaVersion: 1 as const,
  }
}

function reportJob(): ReplayJobDetailContract {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'completed',
    fileName: 'ranked.replay',
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: '2026-08-18T12:01:00.000Z',
    failure: null,
    result: {
      coreDigest: digest,
      schemaVersion: 1,
      core: {
        limitations: [{ code: 'replay-not-live', scopes: ['/'], text: 'Replay deterministic.' }],
        native: {
          players: [
            {
              slot: 0,
              airDodges: 1,
              airJumps: 2,
              airTimeMs: 20_000,
              clashes: 0,
              damageDealt: 120,
              damageTaken: 90,
              dashes: 18,
              dashJumps: 3,
              deaths: 1,
              dodges: 6,
              groundTimeMs: 40_000,
              jumps: 12,
              kos: 2,
              suicides: 0,
              teamDamageDealt: 0,
              teamDamageTaken: 0,
              teamKos: 0,
              wallTimeMs: 0,
            },
            {
              slot: 1,
              airDodges: 0,
              airJumps: 1,
              airTimeMs: 10_000,
              clashes: 0,
              damageDealt: 90,
              damageTaken: 120,
              dashes: 10,
              dashJumps: 1,
              deaths: 2,
              dodges: 3,
              groundTimeMs: 50_000,
              jumps: 8,
              kos: 1,
              suicides: 0,
              teamDamageDealt: 0,
              teamDamageTaken: 0,
              teamKos: 0,
              wallTimeMs: 0,
            },
          ],
        },
        provenance: {
          collector: 'test',
          gameBuild: 'test',
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
          durationMs: 60_000,
          format: 268,
          koTimeline: [
            { victimSlot: 1, scoringSlot: 0, timestampMs: 45_000 },
            { victimSlot: 0, scoringSlot: 1, timestampMs: 20_000 },
          ],
          mapId: 1,
          matchSettings: { lives: 3, scoreToWin: 0, teamMode: false },
          online: true,
          outcome: { winningTeamId: 0 },
          players: [
            {
              entityId: 0,
              loadout: {
                colorId: 0,
                costumeId: 0,
                koEffectId: 0,
                legendId: 3,
                morphWeapon2: false,
                sidekickId: 0,
                stanceId: 0,
                weaponSkin1Id: 0,
                weaponSkin2Id: 0,
              },
              name: 'AxeMender',
              playerId: 12345,
              score: 2,
              slot: 0,
              teamId: 0,
            },
            {
              entityId: 1,
              loadout: {
                colorId: 0,
                costumeId: 0,
                koEffectId: 0,
                legendId: 4,
                morphWeapon2: false,
                sidekickId: 0,
                stanceId: 0,
                weaponSkin1Id: 0,
                weaponSkin2Id: 0,
              },
              name: 'BlueMammoth',
              playerId: null,
              score: 1,
              slot: 1,
              teamId: 1,
            },
          ],
          playlistId: 1,
          randomSeed: 1,
          replayDigest: digest,
          teamScores: [
            { score: 2, teamId: 0 },
            { score: 1, teamId: 1 },
          ],
        },
      },
      extensions: {
        [NATIVE_EXTENSION_URI]: {
          ...identity(),
          data: {
            players: [
              {
                slot: 0,
                payload: {
                  Equipment: {
                    Axe: {
                      TimeHeld: 36_000,
                      Powers: {
                        nLight: { EnemyDamage: 50, EnemyHits: 2, EnemyKOs: 1, TeamDamage: 0, TeamHits: 0, Uses: 4 },
                      },
                    },
                  },
                  Sequence: [],
                },
              },
              {
                slot: 1,
                payload: { Equipment: { Sword: { TimeHeld: 24_000 } }, Sequence: [] },
              },
            ],
          },
        },
        [MATCH_SUMMARY_EXTENSION_URI]: {
          ...identity(),
          data: {
            equipment: [
              { heldTimeShare: 0.6, key: 'Axe', slot: 0, sourcePointer: '/players/0' },
              { heldTimeShare: 0.4, key: 'Sword', slot: 1, sourcePointer: '/players/1' },
            ],
            players: [
              {
                airDodgeShare: 0.5,
                airJumpShare: 0.2,
                airTimeShare: 0.333,
                damageDealtPerKo: 60,
                damageDealtPerMinute: 120,
                damageTakenPerDeath: 90,
                damageTakenPerMinute: 90,
                dashesPerMinute: 18,
                dashJumpShare: 0.25,
                deathsPerMinute: 1,
                dodgesPerMinute: 6,
                friendlyDamageDealtShare: null,
                friendlyDamageTakenShare: null,
                groundTimeShare: 0.667,
                jumpsPerMinute: 12,
                koDeathRatio: 2,
                kosPerMinute: 2,
                slot: 0,
                wallTimeShare: 0,
              },
              {
                airDodgeShare: null,
                airJumpShare: 0.1,
                airTimeShare: 0.167,
                damageDealtPerKo: 90,
                damageDealtPerMinute: 90,
                damageTakenPerDeath: 60,
                damageTakenPerMinute: 120,
                dashesPerMinute: 10,
                dashJumpShare: 0.125,
                deathsPerMinute: 2,
                dodgesPerMinute: 3,
                friendlyDamageDealtShare: null,
                friendlyDamageTakenShare: null,
                groundTimeShare: 0.833,
                jumpsPerMinute: 8,
                koDeathRatio: 0.5,
                kosPerMinute: 1,
                slot: 1,
                wallTimeShare: 0,
              },
            ],
            powers: [
              {
                enemyDamagePerHit: 25,
                enemyDamagePerUse: 12.5,
                enemyHitsPerUse: 0.5,
                enemyKosPerUse: 0.25,
                key: 'Axe/nLight',
                slot: 0,
                sourcePointer: '/players/0',
                teamDamagePerUse: 0,
                teamHitsPerUse: 0,
              },
            ],
            rateDenominatorMs: 60_000,
          },
        },
      },
    },
  }
}

describe('replay report model', () => {
  test('normalizes player, power, and knockout metrics without inventing missing rates', () => {
    const report = buildReplayReport(reportJob())

    expect(report.players[0]).toMatchObject({
      name: 'AxeMender',
      damageDealt: 120,
      damageTaken: 90,
      damageDealtPerKo: 60,
      damageTakenPerDeath: 90,
      suicides: 0,
      clashes: 0,
      teamDamageDealt: 0,
      teamDamageTaken: 0,
      teamKos: 0,
      kosPerMinute: 2,
      dodgesPerMinute: 6,
      airDodgeShare: 0.5,
    })
    expect(report.players[1]?.airDodgeShare).toBeNull()
    expect(report.powers).toEqual([
      expect.objectContaining({
        slot: 0,
        equipmentKey: 'Axe',
        powerKey: 'nLight',
        uses: 4,
        enemyHits: 2,
        enemyDamage: 50,
        enemyKOs: 1,
        accuracy: null,
        hitsPerUse: 0.5,
      }),
    ])
    expect(report.knockouts.map(({ timestampMs }) => timestampMs)).toEqual([20_000, 45_000])
    expect(report.damageMaximum).toBe(120)
  })

  test('formats measured counts and unavailable rates distinctly', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(null)).toBe('—')
    expect(formatRate(0.5)).toBe('50.0%')
    expect(formatRate(null)).toBe('—')
  })
})
