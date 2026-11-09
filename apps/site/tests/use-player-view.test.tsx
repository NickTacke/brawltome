import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { usePlayerView } from '../src/components/player/use-player-view'

function ViewedPage({ recordPlayerView }: { recordPlayerView: (playerId: number) => Promise<unknown> }) {
  usePlayerView(7, recordPlayerView)

  return <h1>Seven</h1>
}

describe('usePlayerView', () => {
  test('the server render never counts a view', () => {
    const recordPlayerView = mock(async () => undefined)

    expect(renderToStaticMarkup(<ViewedPage recordPlayerView={recordPlayerView} />)).toBe('<h1>Seven</h1>')
    expect(recordPlayerView).not.toHaveBeenCalled()
  })
})
