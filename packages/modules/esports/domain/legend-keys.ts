import { legendSlug, legends } from '@brawltome/game-data'

const randomPick = 'random'

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
