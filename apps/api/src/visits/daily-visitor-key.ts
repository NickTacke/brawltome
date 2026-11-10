import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

const dayMs = 86_400_000
const saltBytes = 32

type DailyVisitorKeyOptions = {
  now: () => number
  randomBytes: (size: number) => Uint8Array
}

export type VisitorKey = { key: string; day: string }

function utcDay(timeMs: number): string {
  const dayStartMs = Math.floor(timeMs / dayMs) * dayMs

  return new Date(dayStartMs).toISOString().slice(0, 10)
}

function expandIpv6(address: string): string[] {
  const [head, tail = ''] = address.toLowerCase().split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail ? tail.split(':') : []
  const missing = 8 - headGroups.length - tailGroups.length

  return [...headGroups, ...Array.from({ length: missing }, () => '0'), ...tailGroups]
}

// devices rotate the last 64 bits of an ipv6 address for privacy, often several times a day, while the network
// part stays with the household, so only that part is hashed
function addressForKey(address: string): string {
  const isIpv6 = isIP(address) === 6
  const isMappedIpv4 = address.toLowerCase().startsWith('::ffff:') && address.includes('.')

  if (!isIpv6 || isMappedIpv4) return address

  const network = expandIpv6(address).slice(0, 4)

  return `${network.map((group) => Number.parseInt(group, 16).toString(16)).join(':')}::/64`
}

/**
 * Keys that tell visitors of one utc day apart without naming them: a hash of address and browser, mixed with a
 * random secret that exists only in this process's memory and is replaced, never kept, when the day changes.
 */
export function createDailyVisitorKeys({ now, randomBytes }: DailyVisitorKeyOptions) {
  let saltDay = ''
  let salt: Uint8Array = new Uint8Array()

  function currentDay(): string {
    const day = utcDay(now())

    if (day !== saltDay) {
      saltDay = day
      salt = randomBytes(saltBytes)
    }

    return day
  }

  function keyFor(address: string, userAgent: string): VisitorKey {
    const day = currentDay()
    const hash = createHash('sha256').update(salt).update(addressForKey(address)).update('\n').update(userAgent)

    return { key: hash.digest('hex').slice(0, 32), day }
  }

  // a tab left open overnight keeps its visit id, so the id is renamed with the same daily secret before it's logged
  function visitKeyFor(visitId: string): string {
    currentDay()

    return createHash('sha256').update(salt).update('visit\n').update(visitId).digest('hex').slice(0, 32)
  }

  return { keyFor, visitKeyFor }
}
