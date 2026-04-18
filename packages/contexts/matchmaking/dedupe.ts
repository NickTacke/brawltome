import { createHash } from 'node:crypto'

export function computeDedupeHash(input: {
  randomSeed: number
  version: number
  duration: number
  fanfareId: number
}): string {
  const s = `${input.randomSeed}|${input.version}|${input.duration}|${input.fanfareId}`
  return createHash('sha256').update(s).digest('hex')
}

export function computeRawHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
