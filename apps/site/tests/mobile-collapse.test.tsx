import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MobileCollapse } from '../src/components/player/MobileCollapse'

function render(summary?: string): string {
  return renderToStaticMarkup(
    <MobileCollapse title="Esports" titleClassName="title" summary={summary && <span data-summary>{summary}</span>}>
      <p>body</p>
    </MobileCollapse>,
  )
}

// the opening tag of the element that wraps a marker
function wrapperOf(markup: string, marker: string): string {
  const markerAt = markup.indexOf(marker)
  const wrapperAt = markup.lastIndexOf('<div', markerAt)

  return markup.slice(wrapperAt, markup.indexOf('>', wrapperAt) + 1)
}

describe('mobile collapse', () => {
  test('the summary stays out of the collapsing body', () => {
    const html = render('PR 1')

    expect(html).toContain('PR 1')
    expect(html.indexOf('data-summary')).toBeLessThan(html.indexOf('data-collapse-body'))
  })

  test('the summary is not hidden while the section is closed', () => {
    const html = render('PR 1')

    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-summary')
    expect(wrapperOf(html, 'data-summary')).not.toContain('hidden')
  })
})
