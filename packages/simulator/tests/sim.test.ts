import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getLevelById, levelGeometry } from '@brawltome/game-data'
import { parse } from '@brawltome/replay-format'
import { Simulation } from '../src/sim'

const FIX = join(import.meta.dir, '..', '..', 'replay-format', 'tests', 'fixtures')
const readFixture = (name: string): Uint8Array | null =>
  existsSync(join(FIX, name)) ? new Uint8Array(readFileSync(join(FIX, name))) : null

const mishima = readFixture('mishima.replay')

describe('Simulation integration', () => {
  test.if(mishima !== null)('runs against Mishima replay and produces posture totals covering the match', () => {
    if (!mishima) return
    const parsed = parse(mishima, { inputs: true })
    const meta = getLevelById(parsed.levelId)
    if (!meta) throw new Error(`no LevelMeta for levelId ${parsed.levelId}`)
    const geo = levelGeometry[meta.levelName]
    if (!geo) throw new Error(`no LevelGeometry for levelName ${meta.levelName}`)

    const sim = new Simulation({ parsed, geometry: geo })
    const totals = sim.postureTotals()

    // One entry per entity.
    expect(totals.length).toBe(parsed.entities.length)

    // Every entity's posture-time totals should add up to roughly the match length.
    const lengthMs = parsed.results[0].lengthMs
    for (const t of totals) {
      const sumMs = t.air + t.ground + t.wall
      expect(Math.abs(sumMs - lengthMs)).toBeLessThanOrEqual(50)
    }

    // Physics should produce non-trivial ground time; if everyone is 100% air,
    // the ground/wall resolution never fires and something is wrong.
    const totalGround = totals.reduce((s, t) => s + t.ground, 0)
    expect(totalGround).toBeGreaterThan(0)
  })
})
