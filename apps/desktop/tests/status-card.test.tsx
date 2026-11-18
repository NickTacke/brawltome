import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StatusView } from '../ui/overlay/overlay-view'
import { StatusCard } from '../ui/overlay/StatusCard'

function render(status: StatusView): string {
  return renderToStaticMarkup(<StatusCard status={status} />)
}

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

describe('status card', () => {
  test('connecting spins until the app can read the game', () => {
    const html = render({ state: 'connecting' })

    expect(textOf(html)).toBe('BrawlTomeConnecting to Brawlhalla')
    expect(html).toContain('class="spinner"')
  })

  test('ready names the patch it reads', () => {
    const html = render({ state: 'ready', patch: '11.01' })

    expect(textOf(html)).toBe('BrawlTomeReady·Patch 11.01')
    expect(html).toContain('class="status-ready"')
    expect(html).not.toContain('class="spinner"')
  })

  test('an unsupported patch says so', () => {
    const html = render({ state: 'unsupported', message: "Patch 11.02 isn't supported yet" })

    expect(textOf(html)).toBe('BrawlTomePatch 11.02 isn&#x27;t supported yet')
    expect(html).toContain('class="sub status-warn"')
  })
})
