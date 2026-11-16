import { formatDamage, formatDecimal, formatShare } from './match-format'
import type { MatchPlayer } from './match-players'
import type { NumberRow } from './number-rows'

function accuracy({ insight }: MatchPlayer): number | null {
  const { swings, swingsHit } = insight.oddities

  return swings > 0 ? swingsHit / swings : null
}

function neutralShare({ insight }: MatchPlayer): number | null {
  const openings = insight.neutral.openingsWon + insight.neutral.openingsLost

  return openings > 0 ? insight.neutral.openingsWon / openings : null
}

/** The few numbers that sum a player's match up, under the players beside the replay. */
export const scoreboardRows: NumberRow[] = [
  {
    label: 'KOs',
    value: ({ player }) => String(player.kos),
    score: ({ player }) => player.kos,
    better: 'high',
  },
  {
    label: 'Damage',
    value: ({ player }) => formatDamage(player.damageDealt),
    score: ({ player }) => player.damageDealt,
    better: 'high',
  },
  { label: 'Accuracy', value: (player) => formatShare(accuracy(player)), score: accuracy, better: 'high' },
  { label: 'Neutral won', value: (player) => formatShare(neutralShare(player)), score: neutralShare, better: 'high' },
  {
    label: 'Damage per opening',
    value: ({ insight }) => formatDecimal(insight.neutral.damagePerOpening),
    score: ({ insight }) => insight.neutral.damagePerOpening,
    better: 'high',
  },
]
