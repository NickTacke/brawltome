import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AppStatus, Settings } from '../ui/window/app-status'
import { MainWindow, type MainWindowProps } from '../ui/window/MainWindow'
import { RecentMatches } from '../ui/window/RecentMatches'
import { SettingsSection } from '../ui/window/SettingsSection'

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
      onStartsWithWindowsChange={ignore}
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

  test('leaves the day out while no ranked 1v1 has a result', () => {
    const ready = fixture('ready')
    const you = ready.you === null ? null : { ...ready.you, recentResults: [] }
    const header = partOf(render({ ...ready, you }), 'standing')

    expect(textOf(header)).not.toContain('Today')
  })

  test("counts the session's 1v1 results, not the recent matches", () => {
    const ready = fixture('ready')
    const twoVsTwoWin = { ...ready.recentMatches[1], isWin: true, ratingChange: 14 }
    const header = partOf(render({ ...ready, recentMatches: [ready.recentMatches[0], twoVsTwoWin] }), 'standing')

    expect(textOf(header)).toContain('Today·1W 0L·+18')
  })

  test('a player in placement has no tier yet', () => {
    const ready = fixture('ready')

    const you = { name: 'moonfall', legend: null, rating: 1186, games: 3, recentResults: [] }
    const header = partOf(render({ ...ready, you }), 'standing')

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
    const picker = partOf(html, 'stage')

    expect(picker.match(/aria-checked="true"/g)?.length).toBe(1)
    expect(html).toMatch(/aria-label="Top left"[^>]*aria-checked="true"/)
    expect(html).toContain('data-banner-side="left"')
  })

  test('draws no sign-in and no upload settings', () => {
    const html = render(fixture('ready'))

    expect(html).not.toMatch(/sign in/i)
    expect(html).not.toMatch(/upload/i)
  })

  test('draws the start with Windows toggle in its stored state', () => {
    const on = partOf(render(fixture('ready')), 'toggle')
    const off = partOf(render(fixture('ready'), { settings: { ...settings, startsWithWindows: false } }), 'toggle')

    expect(on).toContain('aria-label="Start with Windows"')
    expect(on).toContain('aria-checked="true"')
    expect(off).toContain('aria-checked="false"')
  })

  test('the toggle asks for the opposite of its stored state', () => {
    const asked: boolean[] = []

    const section = SettingsSection({
      settings,
      onOverlayPositionChange: () => {},
      onStartsWithWindowsChange: (isOn) => asked.push(isOn),
    })

    elementWithClass(section, 'toggle')?.onClick?.()

    expect(asked).toEqual([false])
  })

  test('a paused overlay can be resumed from its line', () => {
    const status = partOf(render({ ...fixture('ready'), isOverlayPaused: true }), 'status-lines')

    expect(textOf(status)).toContain('Overlay pausedResume')
  })
})
