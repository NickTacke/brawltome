import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  // the brawlhalla-anims export bundle: its own node, scripts/ and src/
  animsPath: string
  // bh-native processes left running while art exports, so the export has the memory
  processesDuringArt: number
  // a 2v2 plan or render with nothing in the store takes about 100 s; past fifteen minutes it is stuck
  exportTimeoutMs: number
  // warming a whole patch took 11 minutes on four free cores; the vm shares its cores with bh-native at a lower
  // priority, so a warm gets far more room before it counts as stuck, and a stopped warm fails for good
  warmTimeoutMs: number
  // waits between tries of an art file another attempt is uploading: five tries over 30 s
  uploadRetryDelaysMs: number[]
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
    animsPath: env.REPLAY_ANIMS_PATH ?? '/opt/anims/current',
    processesDuringArt: count(env.REPLAY_PROCESSES_DURING_ART, 1, 'REPLAY_PROCESSES_DURING_ART'),
    exportTimeoutMs: 900_000,
    warmTimeoutMs: milliseconds(env.REPLAY_ART_WARM_TIMEOUT_MS, 3_600_000, 'REPLAY_ART_WARM_TIMEOUT_MS'),
    uploadRetryDelaysMs: [2000, 4000, 8000, 16_000],
  }
}

/**
 * The art format the export bundle writes, which the worker reports with each claim; null turns art off, for a
 * worker without the bundle. Read from the bundle's source, since asking the export itself means loading the game.
 */
export function readArtFormat(animsPath: string): number | null {
  if (!existsSync(join(animsPath, 'scripts', 'export.ts'))) return null

  const formatPath = join(animsPath, 'src', 'format.ts')

  if (!existsSync(formatPath)) return null

  const format = /^export const FORMAT = (\d+);?$/m.exec(readFileSync(formatPath, 'utf8'))?.[1]

  return format === undefined ? null : Number(format)
}

function count(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8)
    throw new Error(`${name} must be a whole number from 0 to 8`)

  return parsed
}

function milliseconds(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a whole number of milliseconds`)

  return parsed
}
