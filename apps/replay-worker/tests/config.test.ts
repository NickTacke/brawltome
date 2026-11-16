import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readArtFormat, readConfig } from '../src/config'

const token = 'replay-worker-token-for-tests-32-bytes-long'

describe('worker settings', () => {
  test('defaults to the production api and the folders the replay role mounts', () => {
    expect(readConfig({ REPLAY_WORKER_TOKEN: token })).toEqual({
      apiUrl: 'https://api.brawltome.app',
      token,
      bhnativePath: '/opt/bhnative/current/bhnative',
      gameRoot: '/srv/brawlhalla',
      workDir: '/work',
      newestProcesses: 3,
      previousProcesses: 1,
      pollMs: 2000,
      renewEveryMs: 120_000,
      replayTimeoutMs: 300_000,
      restartDelayMs: 10_000,
      animsPath: '/opt/anims/current',
      processesDuringArt: 1,
      exportTimeoutMs: 900_000,
      warmTimeoutMs: 3_600_000,
      uploadRetryDelaysMs: [2000, 4000, 8000, 16_000],
    })
  })

  test('a short token is refused', () => {
    expect(() => readConfig({ REPLAY_WORKER_TOKEN: 'short' })).toThrow('REPLAY_WORKER_TOKEN')
  })

  test('process counts can be changed', () => {
    expect(
      readConfig({ REPLAY_WORKER_TOKEN: token, REPLAY_NEWEST_PROCESSES: '2', REPLAY_PREVIOUS_PROCESSES: '0' }),
    ).toMatchObject({
      newestProcesses: 2,
      previousProcesses: 0,
    })
  })

  test('the export bundle and the processes left during an export can be changed', () => {
    const env = { REPLAY_WORKER_TOKEN: token, REPLAY_ANIMS_PATH: '/srv/anims', REPLAY_PROCESSES_DURING_ART: '2' }

    expect(readConfig(env)).toMatchObject({ animsPath: '/srv/anims', processesDuringArt: 2 })
  })

  test('the time a warm may take can be changed, to a whole number of milliseconds', () => {
    const env = { REPLAY_WORKER_TOKEN: token, REPLAY_ART_WARM_TIMEOUT_MS: '7200000' }

    expect(readConfig(env).warmTimeoutMs).toBe(7_200_000)
    expect(() => readConfig({ ...env, REPLAY_ART_WARM_TIMEOUT_MS: 'an hour' })).toThrow('REPLAY_ART_WARM_TIMEOUT_MS')
    expect(() => readConfig({ ...env, REPLAY_ART_WARM_TIMEOUT_MS: '0' })).toThrow('REPLAY_ART_WARM_TIMEOUT_MS')
  })
})

describe('the art format', () => {
  const folders: string[] = []

  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  function bundle(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'replay-worker-anims-'))

    folders.push(root)

    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), text)
    }

    return root
  }

  test('is the format the export bundle writes', () => {
    const animsPath = bundle({ 'scripts/export.ts': '', 'src/format.ts': 'export const FORMAT = 3;\n' })

    expect(readArtFormat(animsPath)).toBe(3)
  })

  test('is null, art off, without the export', () => {
    expect(readArtFormat(bundle({ 'src/format.ts': 'export const FORMAT = 3;\n' }))).toBeNull()
    expect(readArtFormat('/no/such/folder')).toBeNull()
  })

  test('is null when the bundle does not say its format', () => {
    expect(readArtFormat(bundle({ 'scripts/export.ts': '', 'src/format.ts': 'export const OTHER = 1;\n' }))).toBeNull()
  })
})
