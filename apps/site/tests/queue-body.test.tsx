import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueueBody } from '../src/components/queue/QueueBody'
import { activityView, unavailableView } from './queue-fixtures'

describe('QueueBody', () => {
  test('a slow change shows the skeleton in place of the rows', () => {
    const html = renderToStaticMarkup(<QueueBody view={unavailableView('scan_gap')} isLoading />)

    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('A scan was missed')
  })

  test.each([
    [unavailableView('not_enough_history'), 'Not enough history yet'],
    [unavailableView('scan_gap'), 'A scan was missed'],
    [activityView(0), 'Nobody played'],
  ])('shows why there is nothing to list', (view, title) => {
    const html = renderToStaticMarkup(<QueueBody view={view} isLoading={false} />)

    expect(html).toContain(title)
    expect(html).not.toContain('<table')
  })
})
