import { legendName } from '../player/player-format'

// legend keys are lowercase, and the name also shows in a title, which css can't capitalise
export function legendDisplayName(legendKey: string): string {
  return legendName(legendKey).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}
