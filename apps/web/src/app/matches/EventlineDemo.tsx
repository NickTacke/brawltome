import { NATIVE_EXTENSION_URI, type ReplayJobDetailContract } from '@brawltome/contracts'
import { ReplayResultView } from './ReplayResultView'
import { westernAirTempleFixture } from './western-air-temple-fixture'

const demoDigest = `sha256:${'d'.repeat(64)}`
type FixturePlayer = (typeof westernAirTempleFixture.players)[number]

function demoReplayPlayer(player: FixturePlayer) {
  return {
    entityId: player.slot,
    loadout: {
      colorId: 0,
      costumeId: 0,
      koEffectId: 0,
      legendId: player.legendId,
      morphWeapon2: false,
      sidekickId: 0,
      stanceId: 0,
      weaponSkin1Id: 0,
      weaponSkin2Id: 0,
    },
    name: player.name,
    playerId: player.playerId,
    score: player.kos,
    slot: player.slot,
    teamId: player.slot,
  }
}

function demoNativePlayer(player: FixturePlayer) {
  return {
    slot: player.slot,
    airDodges: player.airDodges,
    airJumps: player.airJumps,
    airTimeMs: player.airTimeMs,
    clashes: player.clashes,
    damageDealt: player.damageDealt,
    damageTaken: player.damageTaken,
    dashes: player.dashes,
    dashJumps: player.dashJumps,
    deaths: player.deaths,
    dodges: player.dodges,
    groundTimeMs: player.groundTimeMs,
    jumps: player.jumps,
    kos: player.kos,
    suicides: player.suicides,
    teamDamageDealt: 0,
    teamDamageTaken: 0,
    teamKos: 0,
    wallTimeMs: player.wallTimeMs,
  }
}

function demoNativePayload(player: FixturePlayer) {
  return {
    slot: player.slot,
    payload: {
      Equipment: Object.fromEntries(
        Object.entries(player.equipment).map(([key, equipment]) => [
          key,
          { DamageTaken: equipment.damageTaken, Powers: equipment.powers, TimeHeld: equipment.timeHeldMs },
        ]),
      ),
      Sequence: [],
    },
  }
}

const demoReportJob = {
  id: '00000000-0000-4000-8000-000000000002',
  status: 'completed',
  fileName: 'western-air-temple.replay',
  createdAt: '2026-08-18T12:00:00.000Z',
  updatedAt: '2026-08-18T12:01:00.000Z',
  failure: null,
  result: {
    core: {
      limitations: [
        {
          code: 'legacy-json-fixture',
          scopes: ['/'],
          text: 'Metrics are sourced from the supplied legacy replay dump.',
        },
      ],
      native: { players: westernAirTempleFixture.players.map(demoNativePlayer) },
      replay: {
        durationMs: westernAirTempleFixture.durationMs,
        format: westernAirTempleFixture.format,
        koTimeline: [],
        mapId: westernAirTempleFixture.mapId,
        matchSettings: { lives: westernAirTempleFixture.lives, scoreToWin: 0, teamMode: false },
        online: false,
        outcome: { winningTeamId: 0 },
        players: westernAirTempleFixture.players.map(demoReplayPlayer),
        playlistId: 0,
        randomSeed: 0,
        replayDigest: demoDigest,
        teamScores: westernAirTempleFixture.players.map((player) => ({ score: player.kos, teamId: player.slot })),
      },
    },
    coreDigest: demoDigest,
    extensions: {
      [NATIVE_EXTENSION_URI]: {
        data: { players: westernAirTempleFixture.players.map(demoNativePayload) },
      },
    },
    schemaVersion: 1,
  },
} as unknown as ReplayJobDetailContract

export function EventlineDemo() {
  return <ReplayResultView job={demoReportJob} />
}
