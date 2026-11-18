import { getLegendById } from '@brawltome/game-data/legends'
import { legendSlug } from '@brawltome/game-data/reference-data'

// the line names a legend in capitals, and by its internal name for some, so the name is taken from the game data by
// its id. a legend newer than the game data keeps the line's name

function capitalisedWords(name: string): string {
  const words = name.toLowerCase().split(' ')

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/** The legend's name as the page shows it, and the key the site finds its portrait by. */
export function legendNamesOf(legend: { id: number; name: string }): { legendKey: string; legendName: string } {
  const name = getLegendById(legend.id)?.displayName ?? legend.name

  return { legendKey: legendSlug(legend.id, name), legendName: capitalisedWords(name) }
}
