import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProfileHeader } from '../../../src/components/player/PlayerProfile/ProfileHeader'

const player = {
  brawlhallaId: 42,
  name: 'Canonical Player',
  region: null,
  clan: null,
  matchTimeTotal: 3_600,
}

describe('ProfileHeader', () => {
  test('never falls back to legacy playtime when canonical career is unavailable', () => {
    const html = renderToStaticMarkup(
      <ProfileHeader player={{ ...player, career: null }} topLegend={null} aliases={[]} refreshing={false} />,
    )

    expect(html).not.toContain('Playtime:')
    expect(html).not.toContain('1h')
  })

  test('labels playtime only from the canonical lifetime career snapshot', () => {
    const html = renderToStaticMarkup(
      <ProfileHeader
        player={{ ...player, career: { snapshot: { combat: { matchTime: 7_200 } } } }}
        topLegend={null}
        aliases={[]}
        refreshing={false}
      />,
    )

    expect(html).toContain('Lifetime playtime:')
    expect(html).toContain('2h')
    expect(html).not.toContain('1h')
  })
})
