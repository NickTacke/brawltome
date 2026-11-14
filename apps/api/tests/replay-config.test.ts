import { describe, expect, test } from 'bun:test'
import { readReplayConfig } from '../src/replay-config'

const token = 'replay-worker-token-for-tests-32-bytes-long'
const operator = '14b22ce8-bb52-4181-a5de-dcc1349c5b70'

const complete = {
  REPLAY_WORKER_TOKEN: token,
  R2_ENDPOINT: 'https://75bca8c1b0af15912e4f9efdbde6ec32.r2.cloudflarestorage.com',
  R2_BUCKET: 'brawltome-replays',
  R2_ACCESS_KEY_ID: 'key-id',
  R2_SECRET_ACCESS_KEY: 'secret',
  REPLAY_OPERATOR_ACCOUNTS: `${operator}, `,
}

describe('replay settings', () => {
  test('reads a complete set', () => {
    expect(readReplayConfig(complete)).toEqual({
      workerToken: token,
      storage: {
        endpoint: complete.R2_ENDPOINT,
        bucket: 'brawltome-replays',
        accessKeyId: 'key-id',
        secretAccessKey: 'secret',
      },
      operatorAccountIds: [operator],
      isOpen: false,
    })
  })

  test('without any R2 setting there is no storage, so replays stay off in local development', () => {
    expect(readReplayConfig({ REPLAY_WORKER_TOKEN: token }).storage).toBeNull()
  })

  test('half an R2 setup is refused', () => {
    expect(() => readReplayConfig({ ...complete, R2_SECRET_ACCESS_KEY: undefined })).toThrow('R2_SECRET_ACCESS_KEY')
  })

  test('replays open to everyone only when REPLAYS_OPEN is true', () => {
    expect(readReplayConfig({ ...complete, REPLAYS_OPEN: 'true' }).isOpen).toBe(true)
    expect(readReplayConfig({ ...complete, REPLAYS_OPEN: 'yes' }).isOpen).toBe(false)
  })

  test('a short worker token is refused', () => {
    expect(() => readReplayConfig({ ...complete, REPLAY_WORKER_TOKEN: 'short' })).toThrow('REPLAY_WORKER_TOKEN')
  })

  test('an operator that is not an account id is refused', () => {
    expect(() => readReplayConfig({ ...complete, REPLAY_OPERATOR_ACCOUNTS: 'nick' })).toThrow(
      'REPLAY_OPERATOR_ACCOUNTS',
    )
  })
})
