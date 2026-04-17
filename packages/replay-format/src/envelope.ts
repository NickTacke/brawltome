import { inflateSync } from 'node:zlib'
import { EnvelopeError } from './errors'
import { applyXor } from './xor-key'

export function decodeEnvelope(raw: Uint8Array): Uint8Array {
  let inflated: Buffer
  try {
    inflated = inflateSync(raw)
  } catch (e) {
    throw new EnvelopeError(`zlib inflate failed: ${(e as Error).message}`)
  }
  return applyXor(new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength))
}

/**
 * Returns the format version or null if envelope parsing fails. Never throws.
 *
 * Used by the overlay to classify replays even when the full parser doesn't
 * yet support the version: if we can decode the envelope we report the version
 * (and the server stores the upload as pending), if we can't we still upload
 * raw bytes with no version (rotated XOR key case).
 */
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
