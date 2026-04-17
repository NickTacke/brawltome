import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function generateSlug(): string {
  const bytes = randomBytes(9)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 62]
  return out
}
