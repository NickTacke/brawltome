import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WeaponCardExpanded } from '../../../../src/components/player/WeaponSection/WeaponCardExpanded'
import type { RichWeaponAgg } from '../../../../src/lib/weapon-aggregation'

const weapon: RichWeaponAgg = {
  weapon: 'Sword',
  games: 100,
  wins: 60,
  xp: 250_000,
  totalLevel: 50,
  legendCount: 5,
  timeHeld: 36_000,
  KOs: 200,
  damage: 50_000,
  share: 0.5,
  usageRate: 0.5,
  ranked: {
    games: 50,
    wins: 30,
    ratings: [1_500, 1_700],
    peakRatings: [1_700, 1_900],
    mostPlayed: { name: 'Bodvar', key: 'bodvar', games: 30 },
    highestElo: { name: 'Bodvar', key: 'bodvar', elo: 1_700 },
    highestPeak: { name: 'Bodvar', key: 'bodvar', elo: 1_900 },
  },
}

describe('WeaponCardExpanded', () => {
  test('preserves the V2 overall and ranked weapon-statistics dropdown panels', () => {
    const html = renderToStaticMarkup(<WeaponCardExpanded weapon={weapon} isExpanded panelId="weapon-panel-sword" />)

    expect(html).toContain('Overall Stats')
    expect(html).toContain('Ranked Season')
    expect(html).toContain('50')
    expect(html).toContain('ranked games')
    expect(html).toContain('Avg Elo')
    expect(html).toContain('Highest Peak')
    expect(html.match(/Bodvar/g)).toHaveLength(3)
  })
})
