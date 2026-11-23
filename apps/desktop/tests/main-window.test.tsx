import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AppStatus, OverlayPosition, Settings } from '../ui/window/app-status'
import { MainWindow, type MainWindowProps } from '../ui/window/MainWindow'
import { menuAction, spotGroups, spotLabel } from '../ui/window/overlay-spots'
import { PositionPicker } from '../ui/window/PositionPicker'
import { RecentMatches } from '../ui/window/RecentMatches'
import { SettingsSection } from '../ui/window/SettingsSection'
import { percentText } from '../ui/window/usage-format'

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
  // stops at the first match, so a later component that holds state is never called outside a render
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = elementWithClass(child, className)

      if (found !== null) return found
    }

    return null
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

  test('names the stored overlay spot on a closed menu', () => {
    const settingsPart = partOf(
      render(fixture('ready'), { settings: { ...settings, overlayPosition: 'topLeft' } }),
      'settings',
    )

    const button = partOf(settingsPart, 'spot-button')

    expect(textOf(settingsPart)).toBe('Start with WindowsOverlay spotTop left')
    expect(button).toContain('aria-haspopup="listbox"')
    expect(button).toContain('aria-expanded="false"')
    expect(settingsPart).not.toContain('role="listbox"')
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

describe('last match usage', () => {
  const usage = { cpuMs: 290, cpuPercent: 0.018125, ramMb: 92, requestCount: 1, durationMs: 200_000 }

  function usageText(overrides: Partial<typeof usage>): string {
    const status = { ...fixture('ready'), lastMatchUsage: { ...usage, ...overrides } }

    return textOf(partOf(render(status), 'usage'))
  }

  test('says what the app used in the last match', () => {
    expect(textOf(partOf(render(fixture('ready')), 'usage'))).toBe('Last match·0.02% CPU·92 MB·1 request')
  })

  test('keeps a share too small for two decimals honest', () => {
    expect(percentText(0)).toBe('<0.01%')
    expect(percentText(0.004)).toBe('<0.01%')
    expect(percentText(0.018125)).toBe('0.02%')
    expect(usageText({ cpuPercent: 1.5 })).toContain('1.50% CPU')
  })

  test('counts the requests in words', () => {
    expect(usageText({ requestCount: 0 })).toEndWith('0 requests')
    expect(usageText({ requestCount: 3 })).toEndWith('3 requests')
  })

  test('draws nothing before a match is measured', () => {
    expect(render(fixture('idle'))).not.toContain('class="usage"')
  })
})

describe('overlay spot menu', () => {
  function openMenu(position: OverlayPosition): string {
    return renderToStaticMarkup(<PositionPicker position={position} onChange={() => {}} isInitiallyOpen />)
  }

  test('lists the nine spots in three groups, row by row', () => {
    const groups = spotGroups.map((group) => group.map((spot) => spot.label))

    expect(groups).toEqual([
      ['Top left', 'Top centre', 'Top right'],
      ['Middle left', 'Centre', 'Middle right'],
      ['Bottom left', 'Bottom centre', 'Bottom right'],
    ])

    expect(spotLabel('bottomCenter')).toBe('Bottom centre')
  })

  test('an open menu marks the stored spot and starts on it', () => {
    const html = openMenu('middleRight')
    const list = partOf(html, 'spot-menu')
    const selected = list.match(/<[^>]*aria-selected="true"[^>]*>[^<]*/g) ?? []

    const active = list.match(/<[^>]*data-active="true"[^>]*>[^<]*/g) ?? []
    const rowStarts = list.match(/<[^>]*data-starts-row="true"[^>]*>[^<]*/g) ?? []

    expect(partOf(html, 'spot-button')).toContain('aria-expanded="true"')
    expect(list.match(/role="option"/g)?.length).toBe(9)
    expect(selected.map(textOf)).toEqual(['Middle right'])
    expect(active.map(textOf)).toEqual(['Middle right'])
    expect(rowStarts.map(textOf)).toEqual(['Middle left', 'Bottom left'])
  })

  test('arrow keys move through the spots and stop at the ends', () => {
    expect(menuAction('ArrowDown', 4)).toEqual({ kind: 'move', activeIndex: 5 })
    expect(menuAction('ArrowUp', 4)).toEqual({ kind: 'move', activeIndex: 3 })
    expect(menuAction('ArrowDown', 8)).toEqual({ kind: 'move', activeIndex: 8 })
    expect(menuAction('ArrowUp', 0)).toEqual({ kind: 'move', activeIndex: 0 })
    expect(menuAction('Home', 6)).toEqual({ kind: 'move', activeIndex: 0 })
    expect(menuAction('End', 2)).toEqual({ kind: 'move', activeIndex: 8 })
  })

  test('Enter or Space chooses, Escape or Tab closes, other keys do nothing', () => {
    expect(menuAction('Enter', 1)).toEqual({ kind: 'choose', position: 'topCenter' })
    expect(menuAction(' ', 8)).toEqual({ kind: 'choose', position: 'bottomRight' })
    expect(menuAction('Escape', 3)).toEqual({ kind: 'close' })
    expect(menuAction('Tab', 3)).toEqual({ kind: 'close' })
    expect(menuAction('a', 3)).toEqual({ kind: 'none' })
  })
})
