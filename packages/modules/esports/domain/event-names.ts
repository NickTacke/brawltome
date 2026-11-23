// short event names for result tiles: a title ("Autumn Champs", "Frostbyte #19") and a line under it with the region
// and year ("NA 2026"); brawltools only sends the organiser's full name, which can be 60 characters long

export type EventName = { title: string; region: string | null; year: number }

// a title wraps over two lines of a tile, longer ones lose their edition name
const maximumTitleLength = 22

// a region word counts on its own only, "SEA-food Saturdays" keeps its name
const word = (pattern: string) => new RegExp(`(?<![\\w-])(?:${pattern})(?![\\w-])`, 'i')

const regionNames: [RegExp, string][] = [
  [word('North America|NA|US-E|US-W'), 'NA'],
  [word('South ?East Asia|Southeast Asia|SEA'), 'SEA'],
  [word('Europe|EU'), 'EU'],
  [word('South America|Brazil|BRZ|SA'), 'SA'],
  [word('Middle East|MENA|ME'), 'MENA'],
  [word('Australia|Oceania|AUS'), 'AUS'],
]

// crew battles, triples, brawlball and kung foot land in the 1v1 list, brawltools has no field that sets them apart
const sideModes = /crew battle|triples|\btrio\b|3v3|brawlball|kung foot/i

export function isSideModeEvent(fullName: string): boolean {
  return sideModes.test(fullName)
}

function regionOf(fullName: string): string | null {
  const match = regionNames.find(([pattern]) => pattern.test(fullName))

  return match ? match[1] : null
}

function stripRegions(text: string): string {
  return regionNames.reduce((rest, [pattern]) => rest.replace(new RegExp(pattern.source, 'gi'), ' '), text)
}

const seasonal = /\b(Winter|Spring|Summer|Autumn|Midseason)\b(?: Doubles)? Championships?\b/i

// blue mammoth's own events, named the way players say them
function officialTitle(fullName: string): string | null {
  if (/World Championship Expo/i.test(fullName)) return 'BCX'

  if (/Last Chance Qualifier/i.test(fullName)) return 'BCX LCQ'

  if (/World Championship/i.test(fullName)) return 'Worlds'

  const season = fullName.match(seasonal)

  if (season?.[1]?.toLowerCase() === 'midseason') return 'Midseason'

  if (season) return `${season[1]} Champs`

  if (/Brazil Championship/i.test(fullName)) return 'Brazil Champs'

  const invitational = fullName.match(/\b(SteelSeries|Mammoth Cup|Trial of \w+)/i)

  return invitational ? (invitational[1] ?? null) : null
}

const noise = [
  /\(\$[\d,]+\)/g, // (\$2000)
  /\$[\d,]+(?: Prize Pool)?/gi, // $250 Prize Pool, $100
  /\bPrize Pool\b/gi,
  /\([^)]*\)/g, // (Week 2), (EU)
  /\b[123]v[123]s?\b/gi,
  /\b(?:Singles|Doubles)\b/gi,
  /\bBrawlhalla\b/gi,
  /\bTournaments?\b/gi,
  /\bEdition\b/gi,
  /\b(?:19|20)\d\d\b/g,
  /#[A-Za-z]\w*/g, // #BrawlhallaSponsored
]

// words that carry no identity, dropped first when a title is too long
const fillerWords = /\b(?:Championships?|Series|Invitational|Online|e[Ss]ports|Games|League|Tournament|Edition)\b/g

// an all-caps word reads as shouting on a small tile, three letters or fewer are acronyms (PXL, IBC) and stay
function softenCapitals(word: string): string {
  if (word.length <= 3 || word !== word.toUpperCase() || !/[A-Z]/.test(word)) return word

  return word.charAt(0) + word.slice(1).toLowerCase()
}

// a segment that is only a number ("NA #2 | Peruvian League") belongs with the name after it
function joinBareNumbers(segments: string[]): string[] {
  const joined: string[] = []

  for (const segment of segments) {
    const previous = joined.at(-1)

    if (previous !== undefined && !/[a-z]{2}/i.test(previous)) joined[joined.length - 1] = `${segment} ${previous}`
    else joined.push(segment)
  }

  return joined
}

function cleanSegments(fullName: string): string[] {
  const stripped = noise.reduce((rest, pattern) => rest.replace(pattern, ' '), stripRegions(fullName))

  const segments = stripped
    .split(/\s+[|\-–]\s+|:\s+|,\s+|\s+x\s+/i)
    .map((segment) =>
      segment
        .replace(/[|:,\-–]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.split(' ').map(softenCapitals).join(' '))

  return joinBareNumbers(segments)
}

// whole words only, never an ellipsis; an edition number always stays
function fitTitle(title: string): string {
  if (title.length <= maximumTitleLength) return title

  const number = title.match(/#\d+/)?.[0]
  const words = title.replace(/#\d+/, ' ').replace(fillerWords, ' ').split(/\s+/).filter(Boolean)
  const budget = maximumTitleLength - (number ? number.length + 1 : 0)
  const kept: string[] = []

  for (const next of words) {
    if ([...kept, next].join(' ').length > budget) break

    kept.push(next)
  }

  return [kept.join(' ') || words[0], number].filter(Boolean).join(' ')
}

function communityTitle(fullName: string): string {
  const segments = cleanSegments(fullName)
  const [series = fullName] = segments
  const numbered = segments.find((segment) => /#\d+/.test(segment))

  // a numbered edition ("Frostbyte #19") is already unique, other subtitles are decoration
  if (numbered === series) return fitTitle(series)

  const edition = numbered ?? segments[1]

  if (!edition) return fitTitle(series)

  const combined = `${series} ${edition}`

  if (combined.length <= maximumTitleLength) return combined

  return fitTitle(numbered ?? series)
}

export function eventName(fullName: string, isOfficial: boolean, startTime: number): EventName {
  const year = new Date(startTime * 1000).getUTCFullYear()
  const title = (isOfficial ? officialTitle(fullName) : null) ?? communityTitle(fullName)

  return { title, region: regionOf(fullName), year }
}

// the second choice when two tiles would read the same: the edition on its own, as in "Ignite" for a Galaxy Cup
export function editionTitle(fullName: string): string | null {
  const [, edition] = cleanSegments(fullName)

  return edition ? fitTitle(edition) : null
}

// the open panel has room, so it keeps the edition a tile would drop
function fullCommunityTitle(fullName: string): string {
  const segments = cleanSegments(fullName)
  const [series = fullName] = segments
  const numbered = segments.find((segment) => /#\d+/.test(segment))
  const edition = numbered === series ? undefined : (numbered ?? segments[1])

  return edition ? `${series} ${edition}` : series
}

// the cleaned name for a heading: "Autumn Champs NA 2026", "Galaxy Cup Aurora 2026", never the organiser's raw name
export function eventHeading(fullName: string, isOfficial: boolean, startTime: number): string {
  const { region, year } = eventName(fullName, isOfficial, startTime)
  const title = (isOfficial ? officialTitle(fullName) : null) ?? fullCommunityTitle(fullName)

  return [title, region, year].filter(Boolean).join(' ')
}
