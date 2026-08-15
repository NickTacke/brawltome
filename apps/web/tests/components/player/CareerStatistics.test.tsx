import { describe, expect, test } from 'bun:test'
import type { PlayerCareerProfileContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { CareerStatistics } from '../../../src/components/player/CareerStatistics'

const profile: PlayerCareerProfileContract = {
  brawlhallaId: 42,
  checkedAt: '2026-08-10T10:00:00Z',
  lastSuccessAt: '2026-08-10T10:00:00Z',
  snapshotSource: 'v0-player-snapshot',
  freshness: 'fresh',
  freshForSeconds: 43_200,
  snapshot: {
    guild: null,
    account: { xp: 100, level: 2, xpPercentage: 0.5 },
    combat: {
      games: 10,
      wins: 4,
      matchTime: 600,
      damageBomb: '9007199254740993',
      damageMine: '0',
      damageSpikeball: '0',
      damageSidekick: '0',
      snowballHits: 0,
      bombKos: 0,
      mineKos: 0,
      spikeballKos: 0,
      sidekickKos: 0,
      snowballKos: 0,
    },
    legends: [
      {
        legendId: 3,
        legendNameKey: 'bodvar',
        xp: 100,
        level: 2,
        xpPercentage: 0.5,
        games: 10,
        wins: 4,
        matchTime: 600,
        kos: 20,
        falls: 15,
        suicides: 0,
        teamKos: 1,
        damageDealt: '9007199254740993',
        damageTaken: '800',
        unarmed: { damage: '100', kos: 2 },
        thrownItem: { damage: '10', kos: 1 },
        gadgets: { damage: '20', kos: 0 },
        weaponOne: { damage: '9007199254740993', kos: 12, heldTime: 500 },
        weaponTwo: { damage: '7', kos: 5, heldTime: 100 },
      },
    ],
    weapons: [{ weapon: 'Hammer', heldTime: 500, damage: '9007199254740993', kos: 12 }],
  },
}

describe('CareerStatistics', () => {
  test('labels all lifetime facts and exposes only supported weapon usage measurements', () => {
    const html = renderToStaticMarkup(<CareerStatistics career={profile} />)

    for (const heading of ['Career Statistics', 'Career Combat Record', 'Career Weapon Usage', 'Legend Statistics']) {
      expect(html).toContain(heading)
    }
    expect(html).toContain('Account Level')
    expect(html).toContain('Overall Win Rate')
    expect(html).toContain('9,007,199,254,740,993 damage')
    expect(html).toContain('0.1h · 100.0%')
    const weaponSection = html.slice(html.indexOf('Career Weapon Usage'), html.indexOf('Legend Statistics'))
    for (const unsupported of [' games', ' wins', 'win rate', '>WR<', 'performance', 'strength']) {
      expect(weaponSection.toLowerCase()).not.toContain(unsupported.toLowerCase())
    }
  })

  test('keeps last-known facts visible with delayed-update messaging when stale', () => {
    const html = renderToStaticMarkup(
      <CareerStatistics career={{ ...profile, freshness: 'stale', checkedAt: '2026-08-11T10:00:00Z' }} />,
    )

    expect(html).toContain('Update delayed. Last successful update 2026-08-10.')
    expect(html).toContain('Career Weapon Usage')
    expect(html).toContain('9,007,199,254,740,993 damage')
  })

  test('discloses imported historical snapshots', () => {
    const html = renderToStaticMarkup(
      <CareerStatistics career={{ ...profile, snapshotSource: 'legacy-v2', freshness: 'stale' }} />,
    )

    expect(html).toContain('Historical data from the previous service, observed 2026-08-10.')
    expect(html).toContain('Career Weapon Usage')
  })

  test('shows one compact unavailable explanation and omits deep sections', () => {
    const html = renderToStaticMarkup(<CareerStatistics career={null} />)

    expect(html).toContain('Career Statistics')
    expect(html).toContain('Unavailable')
    expect(html).toContain('Lifetime career facts have not been successfully observed')
    expect(html).not.toContain('Account Statistics')
    expect(html).not.toContain('Career Weapon Usage')
  })

  test('explains a canonical not-yet-observed career state and omits deep sections', () => {
    const unavailable: PlayerCareerProfileContract = {
      brawlhallaId: 42,
      checkedAt: '2026-08-10T10:00:00Z',
      lastSuccessAt: null,
      snapshotSource: null,
      freshness: 'unavailable',
      freshForSeconds: 43_200,
      snapshot: null,
    }
    const html = renderToStaticMarkup(<CareerStatistics career={unavailable} />)

    expect(html).toContain('Lifetime career facts have not been successfully observed')
    expect(html).toContain('Deep career sections are omitted')
    expect(html).toContain('Last checked 2026-08-10')
    expect(html).not.toContain('Account Statistics')
  })

  test('does not report career updating during a ranked-only refresh', () => {
    const html = renderToStaticMarkup(<CareerStatistics career={profile} refreshing={false} />)

    expect(html).toContain('Updated 2026-08-10.')
    expect(html).not.toContain('Updating career statistics')
  })

  test('does not claim last-known facts are visible before the first career success', () => {
    const unavailable: PlayerCareerProfileContract = {
      brawlhallaId: 42,
      checkedAt: '2026-08-10T10:00:00Z',
      lastSuccessAt: null,
      snapshotSource: null,
      freshness: 'unavailable',
      freshForSeconds: 43_200,
      snapshot: null,
    }
    const html = renderToStaticMarkup(<CareerStatistics career={unavailable} refreshing />)

    expect(html).toContain('Updating career statistics')
    expect(html).not.toContain('Last-known lifetime facts remain visible')
  })
})
