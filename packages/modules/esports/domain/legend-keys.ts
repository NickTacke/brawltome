import { legendSlug, legends } from '@brawltome/game-data'

const randomPick = 'random'

// from a legend's letters to the site key: "linfei" to "lin fei", "redraptor" to "redraptor"
export type LegendLookup = ReadonlyMap<string, string>

// the keys the site has legend art for: the lowercase name with spaces kept ("king zuva", "qinghua & baobao"), the
// same slug the site's art files use, so Bödvar is "bodvar" and Red Raptor is "redraptor"; brawltools sends a Random
// pick as "RANDOM" and the game data holds an empty default legend, neither has art
export function buildKnownLegendKeys(): ReadonlySet<string> {
  const keys = new Set<string>()

  for (const legend of legends) {
    const key = legendSlug(legend.heroId, legend.displayName)
    const isPlayable = key !== '' && key !== randomPick

    if (isPlayable) keys.add(key)
  }

  return keys
}

// brawltools writes "LIN_FEI" and "RED_RAPTOR" where the site keeps "lin fei" and "redraptor"; the two agree once
// both are cut down to their letters
function lettersOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

export function legendLookupFrom(siteKeys: Iterable<string>): LegendLookup {
  const lookup = new Map<string, string>()

  for (const key of siteKeys) lookup.set(lettersOf(key), key)

  return lookup
}

/** The lookup for every legend the site has art for. */
export function buildLegendLookup(): LegendLookup {
  return legendLookupFrom(buildKnownLegendKeys())
}

/** The site key of a legend as brawltools names it, or null when the site has no art for it. */
export function resolveLegendKey(brawltoolsName: string, lookup: LegendLookup): string | null {
  return lookup.get(lettersOf(brawltoolsName)) ?? null
}
