import { createHash, randomBytes } from 'node:crypto'

/** Made-up bytes that start like a replay (a zlib stream), with their digest. */
export function fakeReplay(byteSize = 64): { bytes: Uint8Array; digest: string; hex: string } {
  const bytes = new Uint8Array(byteSize)

  bytes.set(randomBytes(byteSize))
  bytes[0] = 0x78
  bytes[1] = 0xda

  const hex = createHash('sha256').update(bytes).digest('hex')

  return { bytes, digest: `sha256:${hex}`, hex }
}
