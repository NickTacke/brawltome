export type WorkerConfig = {
  apiUrl: string
  token: string
  bhnativePath: string
  gameRoot: string
  workDir: string
  // bh-native processes for the newest patch (replays played at once) and for the previous one
  newestProcesses: number
  previousProcesses: number
  pollMs: number
  // the api's lease is 600 s; renewing every two minutes keeps a slow replay's lease with room to spare
  renewEveryMs: number
  // a 3-minute replay takes about 15 s to play; five minutes means the game is stuck
  replayTimeoutMs: number
  restartDelayMs: number
}

type Env = Record<string, string | undefined>

/** The worker's settings; the defaults match what the replay role in ax42-infra mounts into the container. */
export function readConfig(env: Env): WorkerConfig {
  const token = env.REPLAY_WORKER_TOKEN

  if (!token || Buffer.byteLength(token) < 32) throw new Error('REPLAY_WORKER_TOKEN must be set and at least 32 bytes')

  return {
    apiUrl: env.REPLAY_API_URL ?? 'https://api.brawltome.app',
    token,
    bhnativePath: env.REPLAY_BHNATIVE_PATH ?? '/opt/bhnative/current/bhnative',
    gameRoot: env.REPLAY_GAME_ROOT ?? '/srv/brawlhalla',
    workDir: env.REPLAY_WORK_DIR ?? '/work',
    newestProcesses: count(env.REPLAY_NEWEST_PROCESSES, 3, 'REPLAY_NEWEST_PROCESSES'),
    previousProcesses: count(env.REPLAY_PREVIOUS_PROCESSES, 1, 'REPLAY_PREVIOUS_PROCESSES'),
    pollMs: 2000,
    renewEveryMs: 120_000,
    replayTimeoutMs: 300_000,
    restartDelayMs: 10_000,
  }
}

function count(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8)
    throw new Error(`${name} must be a whole number from 0 to 8`)

  return parsed
}
