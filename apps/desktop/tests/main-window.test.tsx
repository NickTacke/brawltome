import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AppStatus, Settings } from '../ui/window/app-status'
import { MainWindow, type MainWindowProps } from '../ui/window/MainWindow'
import { RecentMatches } from '../ui/window/RecentMatches'

// twelve minutes after the newest match in the ready fixture
const NOW_MS = 2_520_000

const settings: Settings = { overlayPosition: 'middleRight', startsWithWindows: true }

function fixture(name: string): AppStatus {
  const file = path.join(import.meta.dir, 'fixtures', `app-status-${name}.json`)

  return JSON.parse(readFileSync(file, 'utf8'))
}

function render(status: AppStatus, overrides: Partial<MainWindowProps> = {}): string {
  const ignore = () => {}

  return renderToStaticMarkup(
    <MainWindow
      status={status}
      settings={settings}
      nowMs={NOW_MS}
      onOpenProfile={ignore}
      onResume={ignore}
      onOverlayPositionChange={ignore}
      onMinimize={ignore}
      onClose={ignore}
      {...overrides}
    />,
  )
}

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

// the markup of the first element carrying the class, so a test can read one part of the window
function partOf(html: string, className: string): string {
  const start = html.search(new RegExp(`<[a-z]+[^>]*? class="([^"]* )?${className}( [^"]*)?"`))

  if (start === -1) return ''

  const tags = /<(\/?)[a-z]+[^>]*?(\/?)>/g
  let depth = 0

  tags.lastIndex = start

  for (let match = tags.exec(html); match !== null; match = tags.exec(html)) {
    const isClosing = match[1] === '/'
    const isSelfClosing = match[2] === '/' || match[0].startsWith('<img')

    if (isSelfClosing) continue

    depth += isClosing ? -1 : 1

    if (depth === 0) return html.slice(start, match.index + match[0].length)
  }

  return ''
}

function withoutResults(status: AppStatus): AppStatus {
  const recentMatches = status.recentMatches.map((recentMatch) => ({ ...recentMatch, isWin: null, ratingChange: null }))

  return { ...status, recentMatches }
}

type ElementProps = { className?: string; children?: ReactNode; onClick?: () => void }

// walks the elements a component returned, without rendering, to reach a handler
function elementWithClass(node: ReactNode, className: string): ElementProps | null {
  if (Array.isArray(node)) {
    return node.map((child) => elementWithClass(child, className)).find((found) => found !== null) ?? null
  }

  if (typeof node !== 'object' || node === null || !('props' in node)) return null

  if ('type' in node && typeof node.type === 'function') {
    const component = node.type as (props: unknown) => ReactNode

    return elementWithClass(component(node.props), className)
  }

  const props = node.props as ElementProps

  if (props.className === className) return props

  return elementWithClass(props.children, className)
}

describe('main window header', () => {
  test("shows the player's own standing and the day's results", () => {
    const header = partOf(render(fixture('ready')), 'standing')

    expect(textOf(header)).toBe('moonfallDiamond·1v12130EloToday·1W 0L·+18')
    expect(header).toContain('src="/banners/Diamond.png"')
  })

  test('leaves the day out while no match has a result', () => {
    const header = partOf(render(withoutResults(fixture('ready'))), 'standing')

    expect(textOf(header)).not.toContain('Today')
  })

  test('a player in placement has no tier yet', () => {
    const ready = fixture('ready')

    const header = partOf(
      render({ ...ready, you: { name: 'moonfall', legend: null, rating: 1186, games: 3 } }),
      'standing',
    )

    expect(textOf(header)).toContain('Placement 3/10·1v1')
    expect(header).toContain('class="banner-empty"')
  })

  test('waits for the game before it knows the player', () => {
    const header = partOf(render(fixture('idle')), 'standing')

    expect(textOf(header)).toBe('Waiting for BrawlhallaStart the game— / —')
    expect(header).toContain('class="banner-empty"')
  })
})

describe('main window', () => {
  test('lists recent matches without a result or Elo change when there is none', () => {
    const matches = partOf(render(withoutResults(fixture('ready'))), 'matches')

    expect(textOf(matches)).toBe('Shinigami12mKoa + rimelight2v232m')
    expect(matches).not.toContain('class="tag')
    expect(matches).not.toContain('class="change')
  })

  test('draws the result and the Elo change once they exist', () => {
    const matches = partOf(render(fixture('ready')), 'matches')

    expect(textOf(matches)).toStartWith('WShinigami+1812m')
    expect(matches).toContain('class="tag won"')
    expect(matches).toContain('class="change up"')
  })

  test('a 2v2 match names both opponents', () => {
    const matches = partOf(render(fixture('ready')), 'matches')

    expect(matches).toContain('Koa + rimelight<small>2v2</small>')
  })

  test('a row click opens the first opponent profile', () => {
    const opened: number[] = []

    const rows = RecentMatches({
      matches: fixture('ready').recentMatches,
      nowMs: NOW_MS,
      onOpenProfile: (brawlhallaId) => opened.push(brawlhallaId),
    })

    elementWithClass(rows, 'match')?.onClick?.()

    expect(opened).toEqual([91913839])
  })

  test('says No matches yet for an empty list', () => {
    const matches = partOf(render(fixture('idle')), 'matches')

    expect(textOf(matches)).toBe('No matches yet')
    expect(matches.match(/class="ghost-row"/g)?.length).toBe(4)
  })

  test('marks the stored overlay position in the picker', () => {
    const html = render(fixture('ready'), { settings: { ...settings, overlayPosition: 'topLeft' } })

    expect(html.match(/aria-checked="true"/g)?.length).toBe(1)
    expect(html).toMatch(/aria-label="Top left"[^>]*aria-checked="true"/)
    expect(html).toContain('data-banner-side="left"')
  })

  test('draws no sign-in and no upload settings', () => {
    const html = render(fixture('ready'))

    expect(html).not.toMatch(/sign in/i)
    expect(html).not.toMatch(/upload/i)
  })

  test('draws Start with Windows only once the app can change it', () => {
    expect(render(fixture('ready'))).not.toContain('Start with Windows')
    expect(render(fixture('ready'), { onStartsWithWindowsChange: () => {} })).toContain('Start with Windows')
  })

  test('a paused overlay can be resumed from its line', () => {
    const status = partOf(render({ ...fixture('ready'), isOverlayPaused: true }), 'status-lines')

    expect(textOf(status)).toContain('Overlay pausedResume')
  })
})
