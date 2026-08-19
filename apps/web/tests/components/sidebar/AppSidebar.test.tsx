import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PlayerShortcutNavigationItem } from '../../../src/lib/playerShortcuts'

mock.module('next/navigation', () => ({ usePathname: () => '/' }))
mock.module('../../../src/components/sidebar/SidebarProvider', () => ({
  useSidebar: () => ({ isMobileOpen: true, close: () => {} }),
}))
const { AppSidebar } = await import('../../../src/components/sidebar/AppSidebar')
const { MobileMenu } = await import('../../../src/components/sidebar/MobileMenu')

const playerShortcuts: PlayerShortcutNavigationItem[] = [
  {
    kind: 'primary',
    href: '/player/42',
    label: 'You',
    accessibleLabel: 'You, Ada',
    avatarUrl: null,
  },
  ...(['Lin', 'Mira', 'Nia'] as const).map((label, index) => ({
    kind: 'pin' as const,
    href: `/player/${44 + index}` as `/player/${number}`,
    label,
    accessibleLabel: `Pinned Player, ${label}`,
    avatarUrl: null,
  })),
]

describe('AppSidebar pinned-player navigation', () => {
  test('anchors the footer while shortcuts are empty and keeps You above pins without a divider', () => {
    const emptyHtml = renderToStaticMarkup(
      <AppSidebar account={null} playerShortcuts={[]} shortcutsLoading shortcutsError={false} />,
    )
    const html = renderToStaticMarkup(
      <AppSidebar account={null} playerShortcuts={playerShortcuts} shortcutsLoading={false} shortcutsError={false} />,
    )

    expect(emptyHtml).toContain('min-h-0 flex-1 overflow-y-auto')
    expect(emptyHtml).toContain('shrink-0 border-t')
    expect(html).not.toContain('<hr class="mt-2 border-white/[0.14]"')
    expect(html).toContain('border-sidebar-border mt-2 border-t pt-2')
    const listStart = html.indexOf('<ul aria-label="Player shortcuts"')
    const shortcutList = html.slice(listStart, html.indexOf('</ul>', listStart))
    expect(shortcutList).toContain('aria-label="You, Ada"')
    expect(shortcutList).toContain('aria-label="Pinned Player, Lin"')
    expect(shortcutList.indexOf('aria-label="You, Ada"')).toBeLessThan(
      shortcutList.indexOf('aria-label="Pinned Player, Lin"'),
    )
  })

  test('renders all pin shortcuts in the independent scroll region', () => {
    const html = renderToStaticMarkup(
      <AppSidebar account={null} playerShortcuts={playerShortcuts} shortcutsLoading={false} shortcutsError={false} />,
    )

    expect(html).toContain('aria-label="Player shortcuts"')
    expect(html).toContain('min-h-0 flex-1 overflow-y-auto')
    expect(html).toContain('aria-label="Pinned Player, Lin"')
    expect(html).toContain('aria-label="Pinned Player, Mira"')
    expect(html).toContain('aria-label="Pinned Player, Nia"')
    expect(html).toContain('aria-label="You, Ada"')
  })
})

describe('MobileMenu pinned-player navigation', () => {
  test('keeps You above pins without a divider', () => {
    const html = renderToStaticMarkup(
      <MobileMenu account={null} playerShortcuts={playerShortcuts} shortcutsLoading={false} shortcutsError={false} />,
    )

    const listStart = html.indexOf('<ul aria-label="Player shortcuts"')
    const shortcutList = html.slice(listStart, html.indexOf('</ul>', listStart))
    expect(shortcutList).toContain('aria-label="You, Ada"')
    expect(shortcutList).toContain('aria-label="Pinned Player, Lin"')
    expect(shortcutList.indexOf('aria-label="You, Ada"')).toBeLessThan(
      shortcutList.indexOf('aria-label="Pinned Player, Lin"'),
    )
    expect(html).not.toContain('border-t border-white/[0.14]')
  })
})
