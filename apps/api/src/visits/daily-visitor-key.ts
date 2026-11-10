import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

const dayMs = 86_400_000

type DailyVisitorKeyOptions = {
  now: () => number
  // the salt of a utc day, the same for every api process; rejects when it can't be read
  loadSalt: (day: string) => Promise<Uint8Array>
}

/** The keys of one utc day, made with that day's salt. */
export type DayVisitorKeys = {
  day: string
  keyFor(address: string, userAgent: string): string
  visitKeyFor(visitId: string): string
}

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

function keysOfDay(day: string, salt: Uint8Array): DayVisitorKeys {
  function keyFor(address: string, userAgent: string): string {
    const hash = createHash('sha256').update(salt).update(addressForKey(address)).update('\n').update(userAgent)

    return hash.digest('hex').slice(0, 32)
  }

  // a tab left open overnight keeps its visit id, so the id is renamed with the same daily secret before it's logged
  function visitKeyFor(visitId: string): string {
    return createHash('sha256').update(salt).update('visit\n').update(visitId).digest('hex').slice(0, 32)
  }

  return { day, keyFor, visitKeyFor }
}

/**
 * Keys that tell visitors of one utc day apart without naming them: a hash of address and browser, mixed with a
 * random secret that every api process shares for the day. It is read once a day and kept in memory until the day
 * changes, so a restart or a second process doesn't give a visitor a second key.
 */
export function createDailyVisitorKeys({ now, loadSalt }: DailyVisitorKeyOptions) {
  let latestRead: { day: string; keys: Promise<DayVisitorKeys> } | undefined

  function forToday(): Promise<DayVisitorKeys> {
    const day = utcDay(now())

    // also true while the read is still under way, so page views that arrive together wait for the same one
    if (latestRead?.day === day) return latestRead.keys

    const read = { day, keys: loadSalt(day).then((salt) => keysOfDay(day, salt)) }

    latestRead = read

    // a failed read is forgotten, so the next page view asks again
    read.keys.catch(() => {
      if (latestRead === read) latestRead = undefined
    })

    return read.keys
  }

  return { forToday }
}
