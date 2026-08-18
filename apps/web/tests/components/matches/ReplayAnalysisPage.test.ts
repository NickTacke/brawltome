import { describe, expect, test } from 'bun:test'
import { selectLoadedReplay, selectUploadedReplay } from '@/app/matches/ReplayAnalysisPage'
import { ReplayReportView } from '@/app/matches/ReplayReportView'
import { ReplayResultView, formatDuration, timelineX } from '@/app/matches/ReplayResultView'
import { getPreviewMatch, replayReportFromPreview } from '@/app/matches/matches-preview-fixtures'
import { MATCH_SUMMARY_EXTENSION_URI } from '@brawltome/contracts'
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
    expect(html.match(/Requires qualified event timeline/g) ?? []).toHaveLength(4)
    expect(html).toContain('Damage progression')
    expect(html).toContain('Best engagement')
    expect(html).toContain('aria-label="Damage comparison"')
    expect(html).toContain('aria-label="Movement comparison"')
    expect(html).toContain('aria-label="AxeMender positioning"')
    expect(html).toContain('Air 45.0% · Ground 54.0% · Wall 1.0%')
    for (const statistic of [
      'KO/death ratio',
      'Team damage dealt',
      'Dodges per minute',
      'Dashes per minute',
      'Jumps per minute',
      'Dash jumps per minute',
      'Air dodge share',
      'Air jump share',
      'Dash jump share',
    ]) {
      expect(html).toContain(statistic)
    }
    expect(html).toContain('nLight')
    expect(html).toContain('18 uses')
    expect(html).toContain('<details')
    expect(html).toContain('Equipment and power details for AxeMender')
    expect(html).toContain('ranked.replay')
    expect(html).toContain('Build 10.07')
    expect(html).toContain('aria-label="Team 10 final score 3, winner"')
    expect(html).toContain('aria-label="Team 20 final score 1"')
    expect(html).toContain('Unknown scorer')
    expect(html).not.toContain('Environment')
    expect(html).not.toContain('Damage progression chart')
  })

  test('renders unsupported fixture-only observations as unavailable', () => {
    const previewMatch = getPreviewMatch('preview-team')
    if (!previewMatch) throw new Error('Preview fixture is missing')

    const html = renderToStaticMarkup(
      createElement(ReplayReportView, { report: replayReportFromPreview(previewMatch) }),
    )

    expect(html).toContain('Equipment and power counters unavailable in preview data.')
    expect(html).toContain('Team damage dealt')
    expect(html).toContain('Suicides')
    expect(html).toContain('>—<')
    expect(html).toContain('2026-08-17 · 18:15 UTC')
    expect(html).toContain('AxeMender &amp; StarLancer vs BlueMammoth &amp; QuickDraw')
    expect(html).toContain('aria-label="Team 1 final score 4, winner"')
    expect(html).toContain('aria-label="Team 2 final score 2"')
  })

  test('renders zero-denominator rates as em dashes', () => {
    const noSummary = structuredClone(completedReplayJob)
    if (!noSummary.result) throw new Error('fixture result missing')
    delete noSummary.result.extensions[MATCH_SUMMARY_EXTENSION_URI]
    const firstNativePlayer = noSummary.result.core.native.players[0]
    if (!firstNativePlayer) throw new Error('fixture native player missing')
    Object.assign(firstNativePlayer, {
      kos: 0,
      deaths: 0,
      dodges: 0,
      dashes: 0,
      jumps: 0,
    })

    const html = renderToStaticMarkup(createElement(ReplayResultView, { job: noSummary }))

    expect(html).toContain('aria-label="KO/death ratio, AxeMender: —"')
    expect(html).toContain('aria-label="Air dodge share, AxeMender: —"')
    expect(html).toContain('aria-label="Air jump share, AxeMender: —"')
    expect(html).toContain('aria-label="Dash jump share, AxeMender: —"')
  })

  test('consumes capability states and wraps replay-controlled names', () => {
    const previewMatch = getPreviewMatch('preview-final')
    if (!previewMatch) throw new Error('Preview fixture is missing')
    const report = replayReportFromPreview(previewMatch)
    report.capabilities.eventTimeline = true
    report.title = 'X'.repeat(1_024)
    report.winnerLabel = 'Y'.repeat(1_024)

    const html = renderToStaticMarkup(createElement(ReplayReportView, { report }))

    expect(html.match(/Qualified event timeline available/g) ?? []).toHaveLength(2)
    expect(html).toContain('break-all')
  })

  test('keeps the uploaded response selected through completed rich-report input', () => {
    const { result: _result, ...summary } = completedReplayJob
    const pending = { ...summary, status: 'pending' as const }

    const uploaded = selectUploadedReplay([], pending)
    const selected = selectLoadedReplay(uploaded.selectedId, completedReplayJob)
    if (!selected) throw new Error('completed replay was not selected')
    const html = renderToStaticMarkup(createElement(ReplayResultView, { job: selected }))

    expect(uploaded).toEqual({ jobs: [pending], selectedId: pending.id })
    expect(selected?.id).toBe(pending.id)
    expect(html).toContain('Selected replay analysis')
    expect(html).toContain('Extended combat')
    expect(selectLoadedReplay('another-job', completedReplayJob)).toBeNull()
  })
})
