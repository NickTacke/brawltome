'use client'

import { getClanAction, refreshClanAction } from '@/app/clan/[id]/actions'
import { NavBar } from '@/components/NavBar'
import { TurnstileGate } from '@/components/TurnstileGate'
import { RefreshTimeoutError, useStaleRefresh } from '@/hooks/useStaleRefresh'
import { isStale } from '@/lib/staleness'
import { CLAN_TTL_MS } from '@brawltome/shared/constants'
import { useCallback, useRef, useState } from 'react'
import { ClanHeader } from './ClanHeader'
import { MemberList } from './MemberList'
import type { SortKey } from './utils'

const PAGE_SIZE = 25

// biome-ignore lint/suspicious/noExplicitAny: dynamic API response
type ClanData = any

interface ClanProfileProps {
  initialData: ClanData | null
  id: string
}

const getTimestamp = (data: ClanData | null): number => {
  if (!data) return 0
  return new Date(data.lastUpdated ?? 0).getTime() || 0
}

export function ClanProfile({ initialData, id }: ClanProfileProps) {
  const isDiscovery = !initialData
  const [page, setPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('default')
  const [turnstileError, setTurnstileError] = useState(false)
  const tokenHandled = useRef(false)

  const queryFn = useCallback(() => getClanAction(Number(id)), [id])
  const shouldStart = useCallback(
    (data: ClanData | null) => isStale(data?.lastUpdated ? new Date(data.lastUpdated) : null, Date.now(), CLAN_TTL_MS),
    [],
  )
  const isDone = useCallback(
    (_prev: ClanData | null, next: ClanData | null) => {
      if (!next) return false
      if (isDiscovery) return (next.members?.length ?? 0) > 0 && next.clanName !== `Clan ${id}`
      const nextTs = getTimestamp(next)
      return nextTs !== 0 && nextTs !== getTimestamp(initialData)
    },
    [isDiscovery, id, initialData],
  )

  const {
    data: clan,
    isRefreshing,
    error,
  } = useStaleRefresh<ClanData | null>({
    initialData,
    queryFn,
    shouldStart,
    isDone,
  })

  const handleToken = useCallback(
    async (token: string) => {
      if (tokenHandled.current) return
      tokenHandled.current = true
      try {
        await refreshClanAction(Number(id), token)
      } catch {
        tokenHandled.current = false
      }
    },
    [id],
  )

  const turnstile = <TurnstileGate onToken={handleToken} onError={() => setTurnstileError(true)} />

  if (error && !(error instanceof RefreshTimeoutError)) {
    throw error
  }

  if (!clan) {
    const lookupFailed = turnstileError || error instanceof RefreshTimeoutError
    return (
      <div>
        <NavBar showBack />
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          {!lookupFailed && (
            <>
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <p>Looking up clan...</p>
            </>
          )}
          {lookupFailed && <p>Clan not found.</p>}
          {turnstile}
        </div>
      </div>
    )
  }

  const members = clan.members || []

  return (
    <div className="space-y-8">
      {turnstile}
      <NavBar showBack />
      <ClanHeader clan={clan} id={id} memberCount={members.length} refreshing={isRefreshing} />
      <MemberList
        members={members}
        totalClanXp={Number(clan.clanXp) || 0}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />
    </div>
  )
}
