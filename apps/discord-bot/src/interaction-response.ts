import { discordTelemetry } from './lib/telemetry'

const EXPIRED_INTERACTION_CODES = new Set([10015, 10062])

type DiscordErrorLike = {
  code?: unknown
  rawError?: { code?: unknown }
}

export function isExpiredInteractionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as DiscordErrorLike
  const code = typeof candidate.code === 'string' ? Number(candidate.code) : candidate.code
  const rawCode =
    typeof candidate.rawError?.code === 'string' ? Number(candidate.rawError.code) : candidate.rawError?.code
  return EXPIRED_INTERACTION_CODES.has(code as number) || EXPIRED_INTERACTION_CODES.has(rawCode as number)
}

export function handleExpiredInteractionError(error: unknown, event: string): boolean {
  if (!isExpiredInteractionError(error)) return false
  discordTelemetry.logger.warn(event)
  return true
}

export async function runInteractionResponse(work: () => Promise<unknown>, event: string): Promise<boolean> {
  try {
    await work()
    return true
  } catch (error) {
    if (!handleExpiredInteractionError(error, event)) throw error
    return false
  }
}
