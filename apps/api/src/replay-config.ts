import type { S3ObjectStoreOptions } from '@brawltome/foundation'

export type ReplayConfig = {
  workerToken: string
  // null when no R2 setting is given at all: local development without a bucket, where replays stay off
  storage: S3ObjectStoreOptions | null
  operatorAccountIds: string[]
  // replays and match pages for everyone; until then operators only (the pages are designed locally first)
  isOpen: boolean
}

type Env = Record<string, string | undefined>

const storageNames = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const
const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The replay worker's token, the R2 bucket for replay files, and the operator accounts, from the environment. */
export function readReplayConfig(env: Env): ReplayConfig {
  const workerToken = env.REPLAY_WORKER_TOKEN

  if (!workerToken || Buffer.byteLength(workerToken) < 32) {
    throw new Error('REPLAY_WORKER_TOKEN must be set and at least 32 bytes')
  }

  return {
    workerToken,
    storage: readStorage(env),
    operatorAccountIds: readOperators(env.REPLAY_OPERATOR_ACCOUNTS),
    isOpen: env.REPLAYS_OPEN === 'true',
  }
}

function readStorage(env: Env): S3ObjectStoreOptions | null {
  const missing = storageNames.filter((name) => !env[name])

  if (missing.length === storageNames.length) return null

  if (missing.length > 0) throw new Error(`replay storage needs ${missing.join(', ')} as well`)

  return {
    endpoint: env.R2_ENDPOINT as string,
    bucket: env.R2_BUCKET as string,
    accessKeyId: env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
  }
}

function readOperators(value: string | undefined): string[] {
  const ids = (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)

  for (const id of ids) {
    if (!accountIdPattern.test(id))
      throw new Error(`REPLAY_OPERATOR_ACCOUNTS holds something that isn't an account id: ${id}`)
  }

  return ids
}
