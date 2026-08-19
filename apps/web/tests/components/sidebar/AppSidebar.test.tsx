import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PlayerShortcutNavigationItem } from '../../../src/lib/playerShortcuts'

mock.module('next/navigation', () => ({ usePathname: () => '/' }))
const { AppSidebar } = await import('../../../src/components/sidebar/AppSidebar')

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
  test('renders all pin shortcuts in the independent scroll region', () => {
    const html = renderToStaticMarkup(
      <AppSidebar account={null} playerShortcuts={playerShortcuts} shortcutsLoading={false} shortcutsError={false} />,
    )

    expect(html).toContain('aria-label="Pinned Players"')
    expect(html).toContain('min-h-0 flex-1 overflow-y-auto')
    expect(html).toContain('aria-label="Pinned Player, Lin"')
    expect(html).toContain('aria-label="Pinned Player, Mira"')
    expect(html).toContain('aria-label="Pinned Player, Nia"')
    expect(html).toContain('aria-label="You, Ada"')
  })
})
