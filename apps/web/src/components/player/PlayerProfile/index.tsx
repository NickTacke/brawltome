'use client'

import { getPlayerAction, refreshPlayerAction } from '@/app/player/[id]/actions'
import { NavBar } from '@/components/NavBar'
import { TurnstileGate } from '@/components/TurnstileGate'
import { RefreshTimeoutError, useStaleRefresh } from '@/hooks/useStaleRefresh'
import { aggregateRichWeaponStats } from '@/lib/weapon-aggregation'
import { TIERED_TTL } from '@brawltome/shared/constants'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { PlayerData } from '../shared'
import { LookupState } from './LookupState'
import { ProfileHeader } from './ProfileHeader'
import { ProfileSections } from './ProfileSections'

interface PlayerProfileProps {
  initialData: PlayerData | null
  id: string
}

const getTimestamp = (data: PlayerData | null): number => {
  if (!data) return 0
  return new Date(data.statsLastUpdated ?? data.rankedLastUpdated ?? 0).getTime() || 0
}

const isInitialDataStale = (data: PlayerData | null): boolean => {
  if (!data) return true
  if (!data.rankedLastUpdated) return true
  return Date.now() - new Date(data.rankedLastUpdated).getTime() > TIERED_TTL.hot.ranked
}

const deriveDisplayLists = (player: PlayerData) => {
  const allLegends = [...(player.statsLegends || [])].sort((a: PlayerData, b: PlayerData) => (b.xp ?? 0) - (a.xp ?? 0))
  const rankedTeams = [...(player.rankedTeams || [])].sort(
    (a: PlayerData, b: PlayerData) => (b.rating ?? 0) - (a.rating ?? 0),
  )
  const aliases: string[] = (player.aliases || [])
    .map((a: PlayerData) => a?.value)
    .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
    .filter((v: string) => v.trim() !== player.name)
    .sort((a: string, b: string) => a.localeCompare(b))
  return { allLegends, rankedTeams, aliases }
}

export function PlayerProfile({ initialData, id }: PlayerProfileProps) {
  const isDiscovery = initialData === null
  const [turnstileError, setTurnstileError] = useState(false)
  const tokenHandled = useRef(false)

  const queryFn = useCallback(() => getPlayerAction(Number(id)), [id])
  const shouldStart = useCallback((data: PlayerData | null) => isInitialDataStale(data), [])
  const isDone = useCallback(
    (_prev: PlayerData | null, next: PlayerData | null) => {
      if (!next) return false
      if (isDiscovery) return next.rating !== 0 || (next.statsLegends?.length ?? 0) > 0
      return getTimestamp(next) !== 0 && getTimestamp(next) !== getTimestamp(initialData)
    },
    [isDiscovery, initialData],
  )

  const {
    data: player,
    isRefreshing,
    error,
  } = useStaleRefresh<PlayerData | null>({ initialData, queryFn, shouldStart, isDone })

  const handleToken = useCallback(
    async (token: string) => {
      if (tokenHandled.current) return
      tokenHandled.current = true
      try {
        await refreshPlayerAction(Number(id), token)
      } catch {
        tokenHandled.current = false
      }
    },
    [id],
  )

  const weaponStats = useMemo(
    () => (player ? aggregateRichWeaponStats(player.statsLegends || [], player.rankedLegends || []) : []),
    [player],
  )

  const turnstile = <TurnstileGate onToken={handleToken} onError={() => setTurnstileError(true)} />

  if (error && !(error instanceof RefreshTimeoutError)) {
    throw error
  }

  if (!player) {
    const lookupFailed = turnstileError || error instanceof RefreshTimeoutError
    return <LookupState errored={lookupFailed} turnstile={turnstile} />
  }

  const { allLegends, rankedTeams, aliases } = deriveDisplayLists(player)

  return (
    <div className="space-y-8 pb-10">
      {turnstile}
      <NavBar showBack />
      <ProfileHeader player={player} topLegend={allLegends[0] ?? null} aliases={aliases} refreshing={isRefreshing} />
      <ProfileSections
        player={player}
        id={id}
        allLegends={allLegends}
        rankedTeams={rankedTeams}
        weaponStats={weaponStats}
      />
    </div>
  )
}
