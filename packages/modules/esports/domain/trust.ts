// whether a brawltools player really is the brawlhalla account it links to: brawltools' brawlhalla id is sometimes
// wrong, and a page must not show someone else's results
export type LinkEvidence = {
  esportsName: string
  eventLegends: string[]
  esportsRegion: string | null
  accountNames: string[]
  accountTopLegends: string[]
  accountRegion: string | null
}

// some names come back from the game api as utf-8 bytes read as latin-1; copied from the site because a module can't
// import the site
function fixEncoding(value: string): string {
  try {
    return decodeURIComponent(escape(value))
  } catch {
    return value
  }
}

const leet: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' }

// mena players often queue on eu servers
const serverRegions: Record<string, string[]> = {
  NA: ['US-E', 'US-W'],
  EU: ['EU'],
  SA: ['BRZ'],
  SEA: ['SEA'],
  MENA: ['ME', 'EU'],
  AUS: ['AUS'],
}

const neededLegendMatches = 2

// "LGN | Marckiem00" and "Marckiemoo" are the same player: no team tag, leetspeak read as letters, no "bh" suffix
export function nameKey(name: string): string {
  const withoutTag = fixEncoding(name).normalize('NFKC').split('|').at(-1) ?? ''

  const letters = withoutTag
    .replace(/#\d+$/, '')
    .toLowerCase()
    .replace(/[0134578]/g, (digit) => leet[digit] ?? digit)
    .replace(/[^a-z]/g, '')

  return letters.replace(/(brawlhalla|bhl|bh)$/, '') || letters
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (const [row, leftCharacter] of [...left].entries()) {
    const current = [row + 1]

    for (const [column, rightCharacter] of [...right].entries()) {
      const substitution = (previous[column] ?? 0) + (leftCharacter === rightCharacter ? 0 : 1)

      current.push(Math.min((previous[column + 1] ?? 0) + 1, (current[column] ?? 0) + 1, substitution))
    }

    previous = current
  }

  return previous.at(-1) ?? 0
}

function isSameName(wanted: string, stored: string): boolean {
  if (wanted === stored) return true

  const shorter = Math.min(wanted.length, stored.length)

  if (shorter >= 4 && (wanted.includes(stored) || stored.includes(wanted))) return true

  return shorter >= 5 && editDistance(wanted, stored) <= 1
}

function hasNameMatch(evidence: LinkEvidence): boolean {
  const wanted = nameKey(evidence.esportsName)
  const stored = evidence.accountNames.map(nameKey).filter(Boolean)

  return wanted !== '' && stored.some((name) => isSameName(wanted, name))
}

function hasPlayMatch(evidence: LinkEvidence): boolean {
  const { esportsRegion, accountRegion } = evidence

  const isRegionMatch =
    esportsRegion !== null && accountRegion !== null && (serverRegions[esportsRegion] ?? []).includes(accountRegion)

  if (!isRegionMatch) return false

  const shared = evidence.eventLegends.slice(0, 3).filter((legend) => evidence.accountTopLegends.includes(legend))

  return shared.length >= neededLegendMatches
}

// trusted on a name or alias match, or on two of the three event legends among the account's top 8 in its region
export function isTrustedLink(evidence: LinkEvidence): boolean {
  return hasNameMatch(evidence) || hasPlayMatch(evidence)
}
