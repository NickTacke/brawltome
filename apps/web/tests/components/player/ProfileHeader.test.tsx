import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProfileHeader } from '../../../src/components/player/PlayerProfile/ProfileHeader'

const player = {
  brawlhallaId: 42,
  name: 'Canonical Player',
  region: null,
  clan: null,
}

describe('ProfileHeader', () => {
  test('does not invent playtime when canonical career is unavailable', () => {
    const html = renderToStaticMarkup(
      <ProfileHeader player={{ ...player, career: null }} topLegend={null} aliases={[]} refreshing={false} />,
    )

    expect(html).not.toContain('Playtime:')
  })

  test('hides canonical measured-zero playtime', () => {
    const html = renderToStaticMarkup(
      <ProfileHeader
        player={{ ...player, career: { snapshot: { guild: null, combat: { matchTime: 0 } } } }}
        topLegend={null}
        aliases={[]}
        refreshing={false}
      />,
    )

    expect(html).not.toContain('Playtime:')
    expect(html).not.toContain('0h')
  })

  test('uses Clans-owned membership before a canonical career snapshot exists', () => {
    const html = renderToStaticMarkup(
      <ProfileHeader
        player={{ ...player, career: null, clan: { clanId: 7, clanName: 'Current Membership' } }}
        topLegend={null}
        aliases={[]}
        refreshing={false}
      />,
    )

    expect(html).toContain('Guild:')
    expect(html).toContain('/clan/7')
    expect(html).toContain('Current Membership')
  })

  test('does not resurrect imported guild after canonical absence', () => {
    const html = renderToStaticMarkup(
      <ProfileHeader
        player={{
          ...player,
          career: { snapshot: { guild: null, combat: { matchTime: 0 } } },
          clan: { clanId: 7, clanName: 'Stale Imported Guild' },
        }}
        topLegend={null}
        aliases={[]}
        refreshing={false}
      />,
    )

    expect(html).not.toContain('Guild:')
    expect(html).not.toContain('Stale Imported Guild')
  })

  test('shows canonical region, guild, and V2-style playtime together', () => {
    const html = renderToStaticMarkup(
      <ProfileHeader
        player={{
          ...player,
          currentSeason: { snapshot: { oneVsOne: { region: 'US-E' } } },
          career: {
            snapshot: {
              guild: { guildId: 2_616_365, guildName: 'Son of God' },
              combat: { matchTime: 7_200 },
            },
          },
          clan: { clanId: 7, clanName: 'Current Membership' },
        }}
        topLegend={null}
        aliases={[]}
        refreshing={false}
      />,
    )

    expect(html).toContain('US-E')
    expect(html).toContain('Playtime:')
    expect(html).not.toContain('Lifetime playtime:')
    expect(html).toContain('2h')
    expect(html).toContain('Guild:')
    expect(html).toContain('/clan/2616365')
    expect(html).toContain('Son of God')
    expect(html).not.toContain('Current Membership')
  })
})
