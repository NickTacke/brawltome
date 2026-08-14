import { type Entity, INTRO_OFFSET_MS, type KoEvent, parse } from '@brawltome/replay-format'

type JsonObject = Record<string, unknown>

export const replaySimulatorCompatibilityVersion = 1 as const
export const replaySimulatorSupportedFormats = [268] as const
export const replaySimulatorGameBuild = 24_439_263 as const
export const replaySimulatorPatchedSwfSha256 =
  '7917260069245f004b851b1407a7914eae8500660609a31892bcd5d79bccf484' as const
export const replaySimulatorSchemaVersion = 2 as const

export type ReplaySimulatorIdentity = {
  simulatorCompatibilityVersion: typeof replaySimulatorCompatibilityVersion
  supportedFormats: readonly [268]
  gameBuild: typeof replaySimulatorGameBuild
  patchedSwfSha256: typeof replaySimulatorPatchedSwfSha256
  schemaVersion: typeof replaySimulatorSchemaVersion
  repositoryRevision: string
}

export function createReplaySimulatorIdentity(repositoryRevision: string): ReplaySimulatorIdentity {
  const revision = repositoryRevision.trim()
  if (!/^[0-9a-f]{7,64}$/i.test(revision)) {
    throw new Error('repository revision must be a 7 to 64 character hexadecimal git revision')
  }
  return {
    simulatorCompatibilityVersion: replaySimulatorCompatibilityVersion,
    supportedFormats: replaySimulatorSupportedFormats,
    gameBuild: replaySimulatorGameBuild,
    patchedSwfSha256: replaySimulatorPatchedSwfSha256,
    schemaVersion: replaySimulatorSchemaVersion,
    repositoryRevision: revision,
  }
}

export const replaySimulatorIdentity = createReplaySimulatorIdentity('0000000')

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function numberField(stats: JsonObject, key: string): number {
  const value = stats[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function derive(stats: JsonObject, durationMs: number) {
  const minutes = durationMs > 0 ? durationMs / 60_000 : 1
  const wall = numberField(stats, 'TimeOnWall')
  const air = numberField(stats, 'TimeInAir')
  const ground = numberField(stats, 'TimeOnGround')
  const totalTime = wall + air + ground
  const dealt = numberField(stats, 'DamageDealt')
  const taken = numberField(stats, 'DamageTaken')
  const kos = numberField(stats, 'KOs')
  const deaths = numberField(stats, 'Deaths')
  const sequence = Array.isArray(stats.Sequence) ? stats.Sequence : []
  const damageFrames = sequence.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const firstDamageFrame = sequence.findIndex((value) => typeof value === 'number')

  return {
    damagePerMinute: round2(dealt / minutes),
    damageTakenPerMinute: round2(taken / minutes),
    kosPerMinute: round2(kos / minutes),
    deathsPerMinute: round2(deaths / minutes),
    damageDealtPerKO: kos > 0 ? round2(dealt / kos) : null,
    damageDealtPerDeath: deaths > 0 ? round2(dealt / deaths) : null,
    kdRatio: deaths > 0 ? round2(kos / deaths) : kos,
    timeDistribution: {
      wall: totalTime > 0 ? round2(wall / totalTime) : 0,
      air: totalTime > 0 ? round2(air / totalTime) : 0,
      ground: totalTime > 0 ? round2(ground / totalTime) : 0,
    },
    totalTimeMs: totalTime,
    matchParticipation: durationMs > 0 ? round2(totalTime / durationMs) : 0,
    peakFrameDamage: damageFrames.length > 0 ? round2(Math.max(...damageFrames)) : null,
    damageSeriesSum: damageFrames.length > 0 ? round2(damageFrames.reduce((sum, value) => sum + value, 0)) : null,
    firstDamageFrame: firstDamageFrame >= 0 ? firstDamageFrame : null,
  }
}

function terminalPlayers(payloads: unknown[]): Map<number, JsonObject> {
  const players = new Map<number, JsonObject>()
  for (const payload of payloads) {
    if (!isObject(payload)) throw new Error('terminal payload is not an object')
    const entries = Object.entries(payload).filter(([key]) => /^Player\d+$/.test(key))
    if (entries.length !== 1)
      throw new Error(`terminal payload must contain exactly one Player<N>, found ${entries.length}`)
    const [key, value] = entries[0]
    if (!isObject(value)) throw new Error(`${key} is not an object`)
    const slot = Number(key.slice('Player'.length))
    if (!Number.isSafeInteger(slot) || slot < 1) throw new Error(`invalid terminal player slot: ${key}`)
    if (players.has(slot)) throw new Error(`duplicate terminal player slot ${slot}`)
    players.set(slot, value)
  }
  return players
}

function winnerTeam(scores: Record<number, number> | undefined, entities: Entity[]): number | null {
  if (!scores) return null
  const totals = new Map<number, number>()
  for (const entity of entities) {
    const score = scores[entity.id]
    if (typeof score === 'number') totals.set(entity.team, (totals.get(entity.team) ?? 0) + score)
  }
  const ordered = [...totals.entries()].sort((left, right) => right[1] - left[1])
  return ordered.length > 0 && (ordered.length === 1 || ordered[0][1] > ordered[1][1]) ? ordered[0][0] : null
}

function loadout(entity: Entity) {
  const hero = entity.playerData.heroes[0]
  if (!hero) throw new Error(`entity ${entity.id} has no hero loadout`)
  return {
    colorSchemeId: entity.playerData.colorSchemeId,
    sidekickId: entity.playerData.spawnBotId,
    koEffectId: entity.playerData.emitterId,
    legendId: hero.heroId,
    skinId: hero.costumeId,
    stanceIndex: hero.stanceIndex,
    weaponSkin1Id: hero.weaponSkin1,
    weaponSkin2Id: hero.weaponSkin2,
    morphWeapon2: hero.morphWeapon2,
  }
}

export function analyzeReplay(replayBytes: Uint8Array, terminalPayloads: unknown[], identity: ReplaySimulatorIdentity) {
  if (
    identity.simulatorCompatibilityVersion !== replaySimulatorCompatibilityVersion ||
    identity.gameBuild !== replaySimulatorGameBuild ||
    identity.patchedSwfSha256 !== replaySimulatorPatchedSwfSha256 ||
    identity.schemaVersion !== replaySimulatorSchemaVersion ||
    identity.supportedFormats.length !== replaySimulatorSupportedFormats.length ||
    identity.supportedFormats.some((format, index) => format !== replaySimulatorSupportedFormats[index])
  ) {
    throw new Error('unsupported simulator identity')
  }
  const replay = parse(replayBytes)
  if (!identity.supportedFormats.includes(replay.formatVersion as 268)) {
    throw new Error(`unsupported replay format ${replay.formatVersion}`)
  }
  const entities = replay.entities.filter((entity) => !entity.isBot)
  const playersBySlot = terminalPlayers(terminalPayloads)
  if (playersBySlot.size !== entities.length) {
    throw new Error(`expected ${entities.length} terminal players, found ${playersBySlot.size}`)
  }
  const expectedSlots = entities.map((_, index) => index + 1)
  if (expectedSlots.some((slot) => !playersBySlot.has(slot)))
    throw new Error('terminal player slots are not contiguous')

  const result = replay.results[0]
  if (!result || result.lengthMs <= 0) throw new Error('replay has no terminal result')
  const gameplayDurationMs = Math.max(0, result.lengthMs - INTRO_OFFSET_MS)
  const players = entities.map((entity, index) => {
    const slot = index + 1
    const terminal = playersBySlot.get(slot)
    if (!terminal) throw new Error(`missing terminal player slot ${slot}`)
    if (terminal.PlayerName !== entity.name) {
      throw new Error(`terminal slot ${slot} name does not match replay entity ${entity.id}`)
    }
    if (terminal.TeamNum !== undefined && Number(terminal.TeamNum) !== entity.team) {
      throw new Error(`terminal slot ${slot} team does not match replay entity ${entity.id}`)
    }
    const stats = { ...terminal, BrawlhallaID: entity.playerId ?? null }
    return {
      slot,
      replayEntityId: entity.id,
      brawlhallaId: entity.playerId ?? null,
      name: entity.name,
      team: entity.team,
      isBot: false,
      loadout: loadout(entity),
      stats,
      derived: derive(stats, gameplayDurationMs),
    }
  })

  const teams = new Map<number, { team: number; players: string[]; score: number | null }>()
  for (const entity of entities) {
    const team = teams.get(entity.team) ?? { team: entity.team, players: [], score: null }
    team.players.push(entity.name)
    const score = result.scores[entity.id]
    if (typeof score === 'number') team.score = (team.score ?? 0) + score
    teams.set(entity.team, team)
  }

  return {
    schemaVersion: replaySimulatorSchemaVersion,
    source: {
      formatVersion: replay.formatVersion,
      randomSeed: replay.randomSeed,
      playlistId: replay.playlistId,
      playlistName: replay.playlistName,
      levelId: replay.levelId,
      onlineGame: replay.onlineGame,
    },
    match: {
      durationMs: result.lengthMs,
      gameplayDurationMs,
      gameSettings: replay.gameSettings,
      winnerTeam: winnerTeam(result.scores, entities),
      teams: [...teams.values()],
      koTimeline: replay.koFaces.map((ko: KoEvent) => ({
        entityId: ko.entityId,
        timestampMs: ko.timestampMs,
        name: entities.find((entity) => entity.id === ko.entityId)?.name ?? null,
      })),
    },
    players,
    provenance: {
      simulator: 'brawlhalla-native-terminal' as const,
      identity,
      parity: 'replay-deterministic' as const,
      limitations: [
        'Live counters accepted before replay playback initializes are not serialized as an authoritative stats snapshot.',
      ],
    },
  }
}
