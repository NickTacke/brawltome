'use client'

import { type PlayerShortcutsContract, parsePlayerShortcutsOutput } from '@brawltome/contracts'
import { useQuery, type useQueryClient } from '@tanstack/react-query'
import { savedPlayersKey } from './savedPlayersCache'
import { trpc } from './trpc'

const PLAYER_SHORTCUTS_KEY = ['account', 'playerShortcuts'] as const

export function playerShortcutsKey(accountId: string | null) {
  return [...PLAYER_SHORTCUTS_KEY, accountId] as const
}

export function parsePlayerShortcutsResponse(value: unknown): PlayerShortcutsContract {
  return parsePlayerShortcutsOutput(value)
}

export function usePlayerShortcuts(accountId: string | null | undefined) {
  const query = useQuery({
    queryKey: playerShortcutsKey(accountId ?? null),
    queryFn: async () => parsePlayerShortcutsResponse(await trpc.account.playerShortcuts.query()),
    enabled: Boolean(accountId),
  })
  return {
    shortcuts: query.data ?? null,
    isLoading: Boolean(accountId) && query.isLoading,
    isError: Boolean(accountId) && query.isError,
  }
}

export function invalidatePlayerShortcuts(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: playerShortcutsKey(accountId) }).then(() => undefined)
}

export async function invalidatePlayerNavigation(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: savedPlayersKey(accountId) }),
    invalidatePlayerShortcuts(queryClient, accountId),
  ])
}

export type PlayerShortcutNavigationItem = {
  kind: 'primary' | 'pin' | 'all-saved'
  href: `/player/${number}` | '/account'
  label: string
  accessibleLabel: string
  avatarUrl: string | null
}

function avatarUrl(legendNameKey: string | undefined): string | null {
  return legendNameKey ? `/images/legends/avatars/${encodeURIComponent(legendNameKey)}.png` : null
}

export function createPlayerShortcutNavigation(
  shortcuts: PlayerShortcutsContract | null,
): PlayerShortcutNavigationItem[] {
  if (!shortcuts) return []

  const items: PlayerShortcutNavigationItem[] = []
  if (shortcuts.primary) {
    items.push({
      kind: 'primary',
      href: `/player/${shortcuts.primary.brawlhallaId}`,
      label: 'You',
      accessibleLabel: shortcuts.primary.name ? `You, ${shortcuts.primary.name}` : 'You',
      avatarUrl: avatarUrl(shortcuts.primary.mainLegend?.legendNameKey),
    })
  }
  for (const pin of shortcuts.pins) {
    const label = pin.name ?? `Player ID ${pin.brawlhallaId}`
    items.push({
      kind: 'pin',
      href: `/player/${pin.brawlhallaId}`,
      label,
      accessibleLabel: `Saved Player, ${label}`,
      avatarUrl: avatarUrl(pin.mainLegend?.legendNameKey),
    })
  }
  items.push({
    kind: 'all-saved',
    href: '/account',
    label: 'All Saved Players',
    accessibleLabel: 'All Saved Players',
    avatarUrl: null,
  })
  return items
}
