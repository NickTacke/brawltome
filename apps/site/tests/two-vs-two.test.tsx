import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SoloQueueEntry } from '../src/components/player/side-summary'
import { TwoVsTwo } from '../src/components/player/TwoVsTwo'

const playedSolo: SoloQueueEntry = {
  rating: 1313,
  peakRating: 1324,
  tier: 'Silver 4',
  wins: 1,
  games: 2,
  secondPlayerId: 0,
  teamName: 'Someone',
  region: 'US-E',
  globalRank: null,
}

describe('Ranked 2v2 solo queue', () => {
  test('a player who never played solo queue is shown as unranked there', () => {
    const html = renderToStaticMarkup(<TwoVsTwo teams={[]} soloQueue={[]} playerId={7} />)

    expect(html).toContain('Solo queue')
    expect(html).toContain('Unranked')
    expect(html).toContain('/images/banners/Unranked.png')
    expect(html).toContain('No games this season')
  })

  test('an unranked solo queue shows no rating or win rate', () => {
    const html = renderToStaticMarkup(<TwoVsTwo teams={[]} soloQueue={[]} playerId={7} />)

    expect(html).not.toContain('Peak')
    expect(html).not.toContain('% of')
  })

  test('a played solo queue keeps its rating and win rate', () => {
    const html = renderToStaticMarkup(<TwoVsTwo teams={[]} soloQueue={[playedSolo]} playerId={7} />)

    expect(html).toContain('Silver 4')
    expect(html).toContain('1,313')
    expect(html).toContain('50.0%')
  })
})
