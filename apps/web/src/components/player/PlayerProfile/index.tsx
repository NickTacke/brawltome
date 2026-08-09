'use client'

import { getPlayerAction, refreshPlayerAction } from '@/app/player/[id]/actions'
import { NavBar } from '@/components/NavBar'
import { TurnstileGate } from '@/components/TurnstileGate'
import { RefreshTimeoutError, useStaleRefresh } from '@/hooks/useStaleRefresh'
import { getPendingPlayerSections, hasCompletedPlayerRefresh } from '@/lib/player-refresh'
import { getRefreshClientAction } from '@/lib/refresh-outcome'
import { aggregateRichWeaponStats } from '@/lib/weapon-aggregation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerData } from '../shared'
import { LookupState } from './LookupState'
import { ProfileHeader } from './ProfileHeader'
import { ProfileSections } from './ProfileSections'

interface PlayerProfileProps {
  initialData: PlayerData | null
  id: string
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
  const [turnstileError, setTurnstileError] = useState(false)
  const [refreshAccepted, setRefreshAccepted] = useState(false)
  const [verificationRequired, setVerificationRequired] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const initialRefreshHandled = useRef(false)
  const tokenHandled = useRef(false)

  const pendingSections = useMemo(() => getPendingPlayerSections(initialData), [initialData])
  const queryFn = () => getPlayerAction(Number(id))
  const shouldStart = () => pendingSections.ranked || pendingSections.stats
  const isDone = (_prev: PlayerData | null, next: PlayerData | null) =>
    hasCompletedPlayerRefresh(initialData, next, pendingSections)

  const {
    data: player,
    isRefreshing,
    error,
  } = useStaleRefresh<PlayerData | null>({
    initialData,
    queryFn,
    shouldStart,
    isDone,
    startSignal: refreshAccepted,
  })

  const applyRefreshOutcome = useCallback((refresh: Parameters<typeof getRefreshClientAction>[0]) => {
    const action = getRefreshClientAction(refresh)
    setRefreshAccepted(action.poll)
    setVerificationRequired(action.verify)
    setRefreshMessage(action.message)
    return action
  }, [])

  useEffect(() => {
    if (initialRefreshHandled.current || (!pendingSections.ranked && !pendingSections.stats)) return
    initialRefreshHandled.current = true
    void refreshPlayerAction(Number(id))
      .then((result) => applyRefreshOutcome(result.refresh))
      .catch(() => setRefreshAccepted(false))
  }, [applyRefreshOutcome, id, pendingSections.ranked, pendingSections.stats])

  const handleToken = useCallback(
    async (token: string) => {
      if (tokenHandled.current) return
      tokenHandled.current = true
      try {
        const result = await refreshPlayerAction(Number(id), token)
        const action = applyRefreshOutcome(result.refresh)
        if (action.verify) tokenHandled.current = false
      } catch {
        tokenHandled.current = false
      }
    },
    [applyRefreshOutcome, id],
  )

  const weaponStats = useMemo(
    () => (player ? aggregateRichWeaponStats(player.statsLegends || [], player.rankedLegends || []) : []),
    [player],
  )

  const turnstile = verificationRequired ? (
    <TurnstileGate onToken={handleToken} onError={() => setTurnstileError(true)} />
  ) : null

  if (error && !(error instanceof RefreshTimeoutError)) {
    throw error
  }

  if (!player) {
    const lookupFailed = turnstileError || error instanceof RefreshTimeoutError
    return <LookupState errored={lookupFailed} message={refreshMessage} turnstile={turnstile} />
  }

  const { allLegends, rankedTeams, aliases } = deriveDisplayLists(player)

  return (
    <div className="space-y-8 pb-10">
      {turnstile}
      {refreshMessage && <output className="text-sm text-muted-foreground">{refreshMessage}</output>}
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
