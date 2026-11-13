import { describe, expect, test } from 'bun:test'
import { readConfig } from '../src/config'

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
})
