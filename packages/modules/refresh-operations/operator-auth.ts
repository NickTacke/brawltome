import { createHash, timingSafeEqual } from 'node:crypto'

export class OperatorAuthenticationError extends Error {
  constructor(readonly code: 'unauthorized' | 'operator_auth_config_invalid') {
    super(code)
  }
}

type OperatorTokenRecord = {
  actorId: string
  tokenSha256: Buffer
}

function parseRecords(value: string | undefined): OperatorTokenRecord[] {
  if (!value) throw new OperatorAuthenticationError('operator_auth_config_invalid')
  let document: unknown
  try {
    document = JSON.parse(value)
  } catch {
    throw new OperatorAuthenticationError('operator_auth_config_invalid')
  }
  if (!Array.isArray(document) || document.length < 1 || document.length > 100) {
    throw new OperatorAuthenticationError('operator_auth_config_invalid')
  }

  const hashes = new Set<string>()
  const actors = new Set<string>()
  return document.map((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new OperatorAuthenticationError('operator_auth_config_invalid')
    }
    const { actorId, tokenSha256 } = record as Record<string, unknown>
    if (
      typeof actorId !== 'string' ||
      actorId !== actorId.trim() ||
      [...actorId].length < 1 ||
      [...actorId].length > 200 ||
      typeof tokenSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(tokenSha256) ||
      actors.has(actorId) ||
      hashes.has(tokenSha256)
    ) {
      throw new OperatorAuthenticationError('operator_auth_config_invalid')
    }
    actors.add(actorId)
    hashes.add(tokenSha256)
    return { actorId, tokenSha256: Buffer.from(tokenSha256, 'hex') }
  })
}

export function authenticateDeadLetterOperator(env: NodeJS.ProcessEnv): string {
  const records = parseRecords(env.DEAD_LETTER_OPERATOR_TOKENS)
  const rawToken = env.DEAD_LETTER_OPERATOR_TOKEN
  if (!rawToken) throw new OperatorAuthenticationError('unauthorized')

  const candidate = createHash('sha256').update(rawToken).digest()
  let actorId: string | null = null
  let matches = 0
  for (const record of records) {
    if (timingSafeEqual(candidate, record.tokenSha256)) {
      actorId = record.actorId
      matches += 1
    }
  }
  if (matches !== 1 || !actorId) throw new OperatorAuthenticationError('unauthorized')
  return actorId
}
