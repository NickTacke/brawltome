import { BitReader } from './bitstream'
import {
  KNOWN_STATES,
  STATE_END,
  STATE_FACES,
  STATE_GAME_DATA,
  STATE_HEADER,
  STATE_INPUTS,
  STATE_INVALID,
  STATE_KO_FACES,
  STATE_RESULTS,
} from './constants'
import { ParseError } from './errors'
import type { Entity, GameSettings, Hero, KoEvent, MatchResult, ParsedReplay } from './types'

function readGameSettings(r: BitReader): GameSettings {
  return {
    flags: r.u32(),
    maxPlayers: r.u32(),
    duration: r.u32(),
    roundDuration: r.u32(),
    startingLives: r.u32(),
    scoringTypeId: r.u32(),
    scoreToWin: r.u32(),
    gameSpeed: r.u32(),
    damageMultiplier: r.u32(),
    levelSetId: r.u32(),
    itemSpawnRuleSetId: r.u32(),
    weaponSpawnRateId: r.u32(),
    gadgetSpawnRateId: r.u32(),
    customGadgetSelection: r.u32(),
    variation: r.u32(),
  }
}

function readHero(r: BitReader): Hero {
  const heroId = r.u32()
  const costumeId = r.u32()
  const stanceIndex = r.u32()
  r.bool()
  const weaponSkin2 = r.bits(15)
  const morphWeapon2 = r.bool()
  const weaponSkin1 = r.bits(15)
  return { heroId, costumeId, stanceIndex, weaponSkin1, weaponSkin2, morphWeapon2 }
}

function readEntity(r: BitReader, heroCount: number): Entity {
  const id = r.i32()
  const name = r.string()
  const colorSchemeId = r.u32()
  const spawnBotId = r.u32()
  const companionId = r.u32()
  const emitterId = r.u32()
  const trailEffectId = r.u32()
  const playerThemeId = r.u32()
  const taunts: number[] = []
  for (let i = 0; i < 8; i++) taunts.push(r.u32())
  const winTauntId = r.u16()
  const loseTauntId = r.u16()
  while (r.bool()) r.u32()
  const avatarId = r.u16()
  const team = r.i32()
  const connectionTime = r.i32()
  const heroes: Hero[] = []
  for (let i = 0; i < heroCount; i++) heroes.push(readHero(r))
  const isBot = r.bool()
  const handicapsEnabled = r.bool()
  if (handicapsEnabled) {
    r.u32()
    r.u32()
    r.u32()
  }
  return {
    id,
    name,
    team,
    isBot,
    playerData: {
      colorSchemeId,
      spawnBotId,
      companionId,
      emitterId,
      trailEffectId,
      playerThemeId,
      taunts,
      winTauntId,
      loseTauntId,
      avatarId,
      connectionTime,
      heroes,
    },
  }
}

export function parse264(envelopeBody: Uint8Array): ParsedReplay {
  const r = new BitReader(envelopeBody)
  const formatVersion = r.u32()

  let header: {
    randomSeed: number
    playlistId: number
    playlistName: string | null
    onlineGame: boolean
  } | null = null
  let gameSettings: GameSettings | null = null
  let levelId = -1
  let heroCount = -1
  const entities: Entity[] = []
  let gameDataChecksum = 0
  const results: MatchResult[] = []
  let koFaces: KoEvent[] = []
  let victoryFaces: KoEvent[] | null = null

  let reached = false
  while (!reached) {
    const state = r.bits(4)
    if (!KNOWN_STATES.has(state)) {
      throw new ParseError(`unknown state code ${state} at bit ${r.position}`)
    }
    switch (state) {
      case STATE_END:
        reached = true
        break
      case STATE_HEADER: {
        const randomSeed = r.u32()
        const playlistId = r.u32()
        const playlistName = playlistId !== 0 ? r.string() : null
        const onlineGame = r.bool()
        header = { randomSeed, playlistId, playlistName, onlineGame }
        break
      }
      case STATE_GAME_DATA: {
        gameSettings = readGameSettings(r)
        levelId = r.u32()
        heroCount = r.u16()
        if (heroCount < 1 || heroCount > 5) {
          throw new ParseError(`heroCount out of range: ${heroCount}`)
        }
        while (r.bool()) entities.push(readEntity(r, heroCount))
        gameDataChecksum = r.u32()
        break
      }
      case STATE_RESULTS: {
        const lengthMs = r.u32()
        const scores: Record<number, number> = {}
        if (r.bool()) {
          while (r.bool()) {
            const eid = r.bits(5)
            const score = r.i16()
            scores[eid] = score
          }
        }
        const endOfMatchFanfareId = r.u32()
        results.push({ lengthMs, scores, endOfMatchFanfareId })
        break
      }
      case STATE_KO_FACES: {
        const arr: KoEvent[] = []
        while (r.bool()) arr.push({ entityId: r.bits(5), timestampMs: r.i32() })
        koFaces = arr
        break
      }
      case STATE_FACES: {
        const arr: KoEvent[] = []
        while (r.bool()) arr.push({ entityId: r.bits(5), timestampMs: r.i32() })
        victoryFaces = arr
        break
      }
      case STATE_INPUTS: {
        // Parse and discard: raw replay is stored in R2 for any re-parse.
        while (r.bool()) {
          r.bits(5)
          const ic = r.i32()
          for (let i = 0; i < ic; i++) {
            r.i32()
            if (r.bool()) r.bits(14)
          }
        }
        break
      }
      case STATE_INVALID:
        throw new ParseError('replay marked invalid (state=8)')
      default:
        throw new ParseError(`unhandled state code ${state}`)
    }
  }

  if (!header) throw new ParseError('missing Header section')
  if (!gameSettings) throw new ParseError('missing GameData section')
  if (results.length === 0) throw new ParseError('missing Results section')

  return {
    formatVersion,
    randomSeed: header.randomSeed,
    playlistId: header.playlistId,
    playlistName: header.playlistName,
    onlineGame: header.onlineGame,
    gameSettings,
    levelId,
    heroCount,
    entities,
    results,
    koFaces,
    victoryFaces,
    gameDataChecksum,
  }
}
