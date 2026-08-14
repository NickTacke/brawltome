import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, peekFormatVersion } from '../src/parser'

const replay = new Uint8Array(readFileSync(join(import.meta.dir, 'fixtures/small-terminus-268.replay')))

test('parses format 268 player ids without changing entity layout', () => {
  expect(peekFormatVersion(replay)).toBe(268)
  const parsed = parse(replay)
  expect(parsed.formatVersion).toBe(268)
  expect(parsed.levelId).toBe(229)
  expect(parsed.entities).toHaveLength(4)
  expect(parsed.entities.every((entity) => Number.isSafeInteger(entity.playerId))).toBe(true)
  expect(parsed.inputs.entities.length).toBeGreaterThan(0)
})
