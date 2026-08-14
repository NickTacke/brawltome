import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from '../src/parser'

const REPLAY_DIR = join(homedir(), 'BrawlhallaReplays')
const readReplay = (name: string): Uint8Array | null => {
  const path = join(REPLAY_DIR, name)
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null
}

describe('format 268 replays', () => {
  const files = ['[10.09] FabledCity.replay', "[10.09] Lich'sTomb.replay"]
  for (const file of files) {
    const raw = readReplay(file)
    test.if(raw !== null)(`parses ${file}`, () => {
      if (!raw) return
      const replay = parse(raw)
      expect(replay.formatVersion).toBe(268)
      expect(replay.entities.length).toBeGreaterThan(1)
      for (const entity of replay.entities) {
        expect(typeof entity.playerId).toBe('number')
        expect(typeof entity.name).toBe('string')
      }
      expect(replay.entities.some((entity) => entity.name.length > 0)).toBe(true)
      expect(replay.koFaces.length).toBeGreaterThan(0)
      expect(replay.results.length).toBeGreaterThan(0)
    })
  }

  const format268 = readReplay('[10.09] FabledCity.replay')
  test.if(format268 !== null)('268 entity has playerId field (the format change)', () => {
    if (!format268) return
    const replay = parse(format268)
    const entity = replay.entities[0]
    expect(entity.playerId).toBeTypeOf('number')
    expect(entity.playerId).toBeGreaterThan(0)
  })

  const format264 = readReplay('[10.05] MishimaDojo.replay')
  test.if(format264 !== null)('264 entity has no playerId (field added in 268)', () => {
    if (!format264) return
    const replay = parse(format264)
    expect(replay.formatVersion).toBe(264)
    expect(replay.entities[0].playerId).toBeUndefined()
  })
})
