import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeReplay, createReplaySimulatorIdentity, replaySimulatorIdentity } from '../replay-analysis'

const fixture = join(import.meta.dir, 'fixtures/replay-analysis')
const replay = new Uint8Array(readFileSync(join(fixture, 'SmallTerminus.replay')))
const payloads = readdirSync(join(fixture, 'terminal'))
  .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]))
  .map((name) => JSON.parse(readFileSync(join(fixture, 'terminal', name), 'utf8')))

test('builds fail-closed schema-v2 statistics from the legitimate format-268 fixture', () => {
  const result = analyzeReplay(replay, payloads, replaySimulatorIdentity)
  expect(result.schemaVersion).toBe(2)
  expect(result.source.formatVersion).toBe(268)
  expect(result.players).toHaveLength(4)
  expect(result.provenance.parity).toBe('replay-deterministic')
  expect(result.provenance.identity).toEqual({
    simulatorCompatibilityVersion: 1,
    supportedFormats: [268],
    gameBuild: 24_439_263,
    patchedSwfSha256: '7917260069245f004b851b1407a7914eae8500660609a31892bcd5d79bccf484',
    schemaVersion: 2,
    repositoryRevision: '0000000',
  })
})

test('rejects missing terminal slots and unqualified simulator identity', () => {
  expect(() => analyzeReplay(replay, payloads.slice(1), replaySimulatorIdentity)).toThrow(/expected 4 terminal players/)
  expect(() => analyzeReplay(replay, payloads, { ...replaySimulatorIdentity, gameBuild: 1 } as never)).toThrow(
    /unsupported simulator identity/,
  )
  expect(createReplaySimulatorIdentity('abcdef1').repositoryRevision).toBe('abcdef1')
  expect(() => createReplaySimulatorIdentity('not-a-git-ref')).toThrow(/repository revision/)
})
