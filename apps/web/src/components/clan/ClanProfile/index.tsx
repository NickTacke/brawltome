'use client'

import { getClanAction, refreshClanAction } from '@/app/clan/[id]/actions'
import { NavBar } from '@/components/NavBar'
import { TurnstileGate } from '@/components/TurnstileGate'
import { RefreshTimeoutError, useStaleRefresh } from '@/hooks/useStaleRefresh'
import { getPendingClanSections, hasCompletedClanRefresh } from '@/lib/clan-refresh'
import type { ClanProfileContract, RefreshOutcomeContract } from '@brawltome/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClanHeader } from './ClanHeader'
import { MemberList } from './MemberList'
import type { SortKey } from './utils'

const PAGE_SIZE = 25
interface ClanProfileProps {
  initialData: ClanProfileContract | null
  id: string
}

export function ClanProfile({ initialData, id }: ClanProfileProps) {
  const clanId = Number(id)
  const [page, setPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('default')
  const [poll, setPoll] = useState(false)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [refresh, setRefresh] = useState<RefreshOutcomeContract | null>(null)
  const requested = useRef(false)
  const pending = useMemo(() => getPendingClanSections(initialData), [initialData])

  const queryFn = useCallback(() => getClanAction(clanId), [clanId])
  const shouldStart = useCallback(() => true, [])
  const isDone = useCallback(
    (_previous: ClanProfileContract | null, next: ClanProfileContract | null) =>
      hasCompletedClanRefresh(initialData, next, pending),
    [initialData, pending],
  )
  const {
    data: clan,
    isRefreshing,
    error,
  } = useStaleRefresh<ClanProfileContract | null>({
    initialData,
    queryFn,
    shouldStart,
    isDone,
    startSignal: poll,
  })

  const requestRefresh = useCallback(
    async (token?: string) => {
      const response = await refreshClanAction(clanId, token)
      setRefresh(response.refresh)
      setNeedsVerification(response.refresh.outcome === 'verificationRequired')
      setPoll(response.refresh.outcome === 'accepted' || response.refresh.outcome === 'alreadyRefreshing')
    },
    [clanId],
  )

  useEffect(() => {
    if (requested.current) return
    requested.current = true
    void requestRefresh().catch(() =>
      setRefresh({ outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } }),
    )
  }, [requestRefresh])

  if (error && !(error instanceof RefreshTimeoutError)) throw error
  const delayed =
    error instanceof RefreshTimeoutError ||
    refresh?.outcome === 'temporarilyUnavailable' ||
    refresh?.outcome === 'rateLimited'

  if (!clan) {
    return (
      <div>
        <NavBar showBack />
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          {!delayed && !needsVerification && <p>Looking up clan...</p>}
          {delayed && <p>Clan data is unavailable. Try again later.</p>}
          {needsVerification && <TurnstileGate onToken={requestRefresh} onError={() => setNeedsVerification(false)} />}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {needsVerification && <TurnstileGate onToken={requestRefresh} onError={() => setNeedsVerification(false)} />}
      <NavBar showBack />
      {delayed && <p className="text-sm text-muted-foreground">Update delayed. Last-known clan data is shown.</p>}
      <ClanHeader clan={clan} id={id} memberCount={clan.members.length} refreshing={isRefreshing} />
      <MemberList
        members={clan.members}
        totalClanXp={clan.clanXp}
        roster={clan.roster}
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
