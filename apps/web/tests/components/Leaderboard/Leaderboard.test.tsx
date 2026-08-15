import { describe, expect, mock, test } from 'bun:test'
import { Children, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LeaderboardErrorState } from '../../../src/components/Leaderboard'

describe('LeaderboardErrorState', () => {
  test('offers recovery without exposing transport details', () => {
    const onRetryAction = mock(() => undefined)
    const errorState = LeaderboardErrorState({ onRetryAction })
    const html = renderToStaticMarkup(errorState)
    const retryButton = Children.toArray(errorState.props.children).find(
      (child) => isValidElement<{ onClick?: () => void }>(child) && child.props.onClick === onRetryAction,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('Unable to load leaderboard data.')
    expect(html).toContain('Try again')
    expect(html).not.toContain('transport')
    expect(retryButton).toBeDefined()
    if (isValidElement<{ onClick?: () => void }>(retryButton)) retryButton.props.onClick?.()
    expect(onRetryAction).toHaveBeenCalledTimes(1)
  })
})
