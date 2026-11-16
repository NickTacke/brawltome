import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { cameraModeOptions } from '../src/components/match/stage/camera-mode'
import { readPlaybackTimeline } from '../src/components/match/stage/playback-timeline'
import { StagePlay } from '../src/components/match/stage/StagePlay'
import { initialLegends } from '../src/components/match/stage/use-legends'
import { readInsights, readPlayback } from './match-fixtures'

type Art = MatchDetailContract['art']

const failedArt: Art = { state: 'failed', manifestUrl: null, baseUrl: null }
const queuedArt: Art = { state: 'queued', manifestUrl: null, baseUrl: null }
const unavailableNote = 'Legends unavailable for this match'
// both players of the fixture are in play here, before the first KO
const bothInPlayMs = 20_000

function renderStagePlay(art: Art): string {
  const insights = readInsights('duel-a')
  const legends = { ...initialLegends(art), timeline: readPlaybackTimeline(readPlayback('duel-a')) }

  return renderToStaticMarkup(
    <StagePlay insights={insights} legends={legends} timeMs={bothInPlayMs} cameraMode="game" selectedSlot={1} />,
  )
}

describe('the match stage', () => {
  test('with failed art, it draws portrait tokens and says the legends are unavailable', () => {
    const markup = renderStagePlay(failedArt)

    expect(markup).toContain('alt="Player A"')
    expect(markup).toContain('alt="Player B"')
    expect(markup).toContain('/images/legends/avatars/')
    expect(markup).toContain(unavailableNote)
  })

  test('with art still queued, it draws portrait tokens without the note', () => {
    const markup = renderStagePlay(queuedArt)

    expect(markup).toContain('alt="Player A"')
    expect(markup).toContain('alt="Player B"')
    expect(markup).not.toContain(unavailableNote)
  })

  test('the camera is the game’s or fixed, nothing else', () => {
    expect(cameraModeOptions.map((option) => option.label)).toEqual(['Game', 'Fixed'])
  })
})
