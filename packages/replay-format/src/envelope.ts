import { inflateSync } from 'node:zlib'
import { EnvelopeError } from './errors'
import { applyXor } from './xor-key'

// Max inflated size (zip-bomb cap). Our ~25 KB samples inflate to ~210 KB; 2 MB is a generous upper bound.
const MAX_INFLATED_BYTES = 2 * 1024 * 1024

export function decodeEnvelope(raw: Uint8Array): Uint8Array {
  let inflated: Buffer
  try {
    inflated = inflateSync(raw, { maxOutputLength: MAX_INFLATED_BYTES })
  } catch (e) {
    throw new EnvelopeError(`zlib inflate failed: ${(e as Error).message}`)
  }
  return applyXor(new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength))
}

// Returns the format version or null on any failure. Never throws; lets the overlay
// classify replays even when the full parser doesn't yet support the version.
export function peekFormatVersion(raw: Uint8Array): number | null {
  try {
    const body = decodeEnvelope(raw)
    if (body.length < 4) return null
    const dv = new DataView(body.buffer, body.byteOffset, 4)
    return dv.getUint32(0)
  } catch {
    return null
  }
}
