import { describe, expect, test } from 'bun:test'
import { ReplayReportView } from '@/app/matches/ReplayReportView'
import { ReplayResultView, formatDuration, timelineX } from '@/app/matches/ReplayResultView'
import { getPreviewMatch, replayReportFromPreview } from '@/app/matches/matches-preview-fixtures'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { completedReplayJob } from '../../fixtures/completed-replay-job'

describe('replay result graphs', () => {
  test('formats duration and keeps KO markers inside the graph', () => {
    expect(formatDuration(113_296)).toBe('1:53')
    expect(timelineX(0, 113_296)).toBe(20)
    expect(timelineX(200_000, 113_296)).toBe(980)
  })

  test('labels fixture-backed reports as preview data', () => {
    const previewMatch = getPreviewMatch('preview-final')
    if (!previewMatch) throw new Error('Preview fixture is missing')

    const html = renderToStaticMarkup(
      createElement(ReplayReportView, { report: replayReportFromPreview(previewMatch) }),
    )

    expect(html).toContain('Preview data')
  })

  test('renders the visual report in the approved order with truthful source data', () => {
    const html = renderToStaticMarkup(createElement(ReplayResultView, { job: completedReplayJob }))
    const headings = [
      'Event overview',
      'Extended combat',
      'Movement & positioning',
      'Dodge directions',
      'Engagements',
      'Knockout sequence',
      'Replay details',
    ]

    const renderedText = html.replaceAll('&amp;', '&')
    for (const [index, heading] of headings.entries()) {
      expect(renderedText).toContain(heading)
      const previousHeading = headings[index - 1]
      if (previousHeading) {
        expect(renderedText.indexOf(heading)).toBeGreaterThan(renderedText.indexOf(previousHeading))
      }
    }
    expect(html.match(/Requires qualified event timeline/g) ?? []).toHaveLength(3)
    expect(html).toContain('aria-label="Damage comparison"')
    expect(html).toContain('aria-label="Movement comparison"')
    expect(html).toContain('aria-label="AxeMender positioning"')
    expect(html).toContain('Air 45.0% · Ground 54.0% · Wall 1.0%')
    expect(html).toContain('nLight')
    expect(html).toContain('18 uses')
    expect(html).not.toContain('dodges/min')
    expect(html).toContain('Unknown scorer')
    expect(html).not.toContain('Environment')
    expect(html).not.toContain('Damage progression chart')
  })
})
