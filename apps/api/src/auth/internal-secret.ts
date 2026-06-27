import { timingSafeEqual } from 'node:crypto'

/** Constant-time comparison of a provided internal secret against the expected one. */
export function internalSecretValid(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}
