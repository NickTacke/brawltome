import { OperatorAuthenticationError, authenticateDeadLetterOperator } from './operator-auth'
import { createPostgresDeadLetterOperations } from './postgres'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CliErrorCode =
  | 'invalid_command'
  | 'invalid_operation_id'
  | 'invalid_limit'
  | 'invalid_cursor'
  | 'invalid_reason'
  | 'not_found'
  | 'already_disposed'
  | 'configuration_error'

class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    message: string,
  ) {
    super(message)
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new CliError('invalid_command', `${name} requires a value`)
  return value
}

function operationId(args: string[]): string {
  const value = args[1]
  if (!value || !uuid.test(value)) throw new CliError('invalid_operation_id', 'operation ID must be a UUID')
  return value
}

function reason(args: string[]): string {
  const value = option(args, '--reason')
  const trimmed = value?.trim() ?? ''
  const length = [...trimmed].length
  if (length < 1 || length > 500) {
    throw new CliError('invalid_reason', 'reason must contain between 1 and 500 characters')
  }
  return trimmed
}

function parseList(args: string[]) {
  const rawLimit = option(args, '--limit')
  const limit = rawLimit === undefined ? 50 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new CliError('invalid_limit', 'limit must be an integer between 1 and 100')
  }
  const cursor = option(args, '--cursor')
  if (cursor && !uuid.test(cursor)) throw new CliError('invalid_cursor', 'cursor must be a UUID')
  return { limit, cursor }
}

function writeJson(stream: typeof process.stdout | typeof process.stderr, value: unknown) {
  stream.write(`${JSON.stringify(value)}\n`)
}

async function main() {
  const actorId = authenticateDeadLetterOperator(process.env)
  const args = process.argv.slice(2)
  const command = args[0]

  type ParsedCommand =
    | { command: 'list'; input: ReturnType<typeof parseList> }
    | { command: 'inspect'; operationId: string }
    | { command: 'replay' | 'discard'; operationId: string; reason: string }
  let parsed: ParsedCommand
  switch (command) {
    case 'list':
      parsed = { command, input: parseList(args) }
      break
    case 'inspect':
      parsed = { command, operationId: operationId(args) }
      break
    case 'replay':
    case 'discard':
      parsed = { command, operationId: operationId(args), reason: reason(args) }
      break
    default:
      throw new CliError('invalid_command', 'command must be list, inspect, replay, or discard')
  }

  const connectionString = process.env.DEAD_LETTER_DATABASE_URL
  if (!connectionString) throw new CliError('configuration_error', 'DEAD_LETTER_DATABASE_URL is required')
  const operations = createPostgresDeadLetterOperations(connectionString)
  try {
    if (parsed.command === 'list') {
      writeJson(process.stdout, { ok: true, data: await operations.listDeadLetters(parsed.input) })
      return
    }
    if (parsed.command === 'inspect') {
      const inspection = await operations.inspectDeadLetter(parsed.operationId)
      if (!inspection) throw new CliError('not_found', 'dead letter not found')
      writeJson(process.stdout, { ok: true, data: inspection })
      return
    }

    const result = await (parsed.command === 'replay'
      ? operations.replayDeadLetter({ operationId: parsed.operationId, actorId, reason: parsed.reason })
      : operations.discardDeadLetter({ operationId: parsed.operationId, actorId, reason: parsed.reason }))
    if (result.outcome === 'not-found') throw new CliError('not_found', 'dead letter not found')
    if (result.outcome === 'already-disposed') {
      throw new CliError('already_disposed', `dead letter was already ${result.disposition}`)
    }
    writeJson(process.stdout, { ok: true, data: result })
  } finally {
    await operations.close()
  }
}

try {
  await main()
} catch (error) {
  process.exitCode = 1
  if (error instanceof OperatorAuthenticationError) {
    writeJson(process.stderr, { ok: false, error: { code: error.code, message: 'operator authentication failed' } })
  } else if (error instanceof CliError) {
    writeJson(process.stderr, { ok: false, error: { code: error.code, message: error.message } })
  } else {
    writeJson(process.stderr, {
      ok: false,
      error: { code: 'operation_failed', message: 'dead-letter operation failed' },
    })
  }
}
