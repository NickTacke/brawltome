import { createHash } from 'node:crypto'

const dayOf = (ms: number) => Math.floor(ms / 86_400_000)

export function createDailySalt(now: () => number, random: (bytes: number) => Uint8Array) {
  let day = -1
  let salt: Uint8Array = new Uint8Array()
  return {
    visitorKey(ip: string, userAgent: string): string {
      const today = dayOf(now())
      if (today !== day) {
        day = today
        salt = random(32)
      }
      return createHash('sha256').update(salt).update(ip).update('\n').update(userAgent).digest('hex').slice(0, 16)
    },
  }
}
