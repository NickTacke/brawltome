import type { S3ObjectStoreOptions } from '@brawltome/foundation'

export type ReplayConfig = {
  workerToken: string
  // null when no R2 setting is given at all: local development without a bucket, where replays stay off
  storage: S3ObjectStoreOptions | null
  // the public art bucket and the address it is served at; null when no ART_ setting is given, and then no art is
  // exported
  art: { storage: S3ObjectStoreOptions; baseUrl: string } | null
  operatorAccountIds: string[]
  // replays and match pages for everyone; until then operators only (the pages are designed locally first)
  isOpen: boolean
}

type Env = Record<string, string | undefined>

const storageNames = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const
const artNames = ['ART_R2_BUCKET', 'ART_R2_ACCESS_KEY_ID', 'ART_R2_SECRET_ACCESS_KEY', 'ART_BASE_URL'] as const
const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The replay worker's token, the R2 buckets for replay files and art, and the operator accounts, from the
 * environment.
 */
export function readReplayConfig(env: Env): ReplayConfig {
  const workerToken = env.REPLAY_WORKER_TOKEN

  if (!workerToken || Buffer.byteLength(workerToken) < 32) {
    throw new Error('REPLAY_WORKER_TOKEN must be set and at least 32 bytes')
  }

  const storage = readStorage(env)

  return {
    workerToken,
    storage,
    art: readArt(env, storage),
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

function readArt(env: Env, storage: S3ObjectStoreOptions | null): ReplayConfig['art'] {
  const missing = artNames.filter((name) => !env[name])

  if (missing.length === artNames.length) return null

  if (missing.length > 0) throw new Error(`the art bucket needs ${missing.join(', ')} as well`)

  // the art bucket lives on the same R2 account, so it takes the replays bucket's endpoint
  if (!storage) throw new Error('the art bucket needs the replays bucket too, R2_ENDPOINT and the rest')

  return {
    storage: {
      endpoint: storage.endpoint,
      bucket: env.ART_R2_BUCKET as string,
      accessKeyId: env.ART_R2_ACCESS_KEY_ID as string,
      secretAccessKey: env.ART_R2_SECRET_ACCESS_KEY as string,
    },
    baseUrl: readArtBaseUrl(env.ART_BASE_URL as string),
  }
}

function readArtBaseUrl(value: string): string {
  if (!URL.canParse(value) || new URL(value).protocol !== 'https:') {
    throw new Error(`ART_BASE_URL must be an https address, not ${value}`)
  }

  // the api joins art paths to it with a slash of its own
  return value.replace(/\/+$/, '')
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
