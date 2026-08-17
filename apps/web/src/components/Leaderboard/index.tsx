'use client'

import {
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui'
import { saveAccountPreferences, useAccount, useAccountPreferences } from '@/lib/auth'
import { trpc } from '@/lib/trpc'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SoloLeaderboardRow, TeamLeaderboardRow } from './LeaderboardRow'
import { LeaderboardSkeletonRows } from './LeaderboardSkeleton'
import { PaginationControls } from './PaginationControls'
import {
  BRACKETS,
  type BracketId,
  DEFAULT_LEADERBOARD_PREFERENCES,
  type LeaderboardEntry,
  type LeaderboardFilters,
  MAX_PAGE,
  PAGE_SIZE,
  REGIONS,
  type RegionId,
  buildLeaderboardQueryString,
  isTeamEntry,
  parseLeaderboardSearchParams,
  preferencesForLeaderboardUpdate,
  snapshotNotice,
} from './utils'

export function LeaderboardErrorState({ onRetryAction }: { onRetryAction: () => void }) {
  return (
    <Card
      role="alert"
      className="w-full max-w-4xl mx-auto mt-12 bg-destructive/10 border-destructive text-destructive-foreground p-6 text-center"
    >
      <p>Unable to load leaderboard data.</p>
      <Button type="button" variant="outline" className="mt-4" onClick={onRetryAction}>
        Try again
      </Button>
    </Card>
  )
}

export function Leaderboard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { account, isLoading: accountLoading } = useAccount()
  const preferenceAccountId = accountLoading ? undefined : (account?.id ?? null)
  const { preferences, isLoading: preferencesLoading } = useAccountPreferences(preferenceAccountId)
  const effectivePreferences = preferences ?? DEFAULT_LEADERBOARD_PREFERENCES

  const filters = useMemo<LeaderboardFilters>(
    () => parseLeaderboardSearchParams(new URLSearchParams(searchParams.toString()), effectivePreferences),
    [searchParams, effectivePreferences],
  )
  const { bracket, region, page } = filters

  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [fetchedKey, setFetchedKey] = useState('')
  const [knownLastPage, setKnownLastPage] = useState<number | null>(null)
  const [snapshotStatus, setSnapshotStatus] = useState<'fresh' | 'stale' | 'unavailable' | null>(null)
  const snapshotRef = useRef<{ scopeKey: string; snapshotId: string } | null>(null)
  const [preferenceError, setPreferenceError] = useState<string | null>(null)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const [requestVersion, setRequestVersion] = useState(0)

  const updateFilters = useCallback(
    (next: Partial<LeaderboardFilters>) => {
      const merged: LeaderboardFilters = { ...filters, ...next }
      const qs = buildLeaderboardQueryString(merged)
      router.push(`${pathname}?${qs}`, { scroll: false })

      const preferenceUpdate = preferencesForLeaderboardUpdate(filters, next, account !== null)
      if (preferenceUpdate && account) {
        setPreferenceError(null)
        setPreferencesSaving(true)
        void saveAccountPreferences(queryClient, account.id, preferenceUpdate)
          .catch((cause: unknown) => {
            console.error('[preferences] failed to save leaderboard defaults', cause)
            setPreferenceError('Could not save your leaderboard defaults. Your current filters still work.')
          })
          .finally(() => setPreferencesSaving(false))
      }
    },
    [account, filters, pathname, queryClient, router],
  )

  useEffect(() => {
    if (preferencesLoading) return

    let cancelled = false
    const scopeKey = `${bracket}:${region}`
    const scopeChanged = snapshotRef.current?.scopeKey !== scopeKey
    setIsLoading(true)
    setFailed(false)
    setKnownLastPage(null)
    if (scopeChanged) {
      snapshotRef.current = null
      setEntries([])
      setSnapshotStatus(null)
    }

    const request = trpc.leaderboard.get.query({
      mode: bracket,
      region,
      page,
      pageSize: PAGE_SIZE,
      snapshotId: snapshotRef.current?.snapshotId,
    })

    request
      .then((data) => {
        if (cancelled) return
        setSnapshotStatus(data.status)
        if (data.status === 'unavailable') {
          snapshotRef.current = null
          setEntries([])
          setKnownLastPage(data.page)
        } else {
          snapshotRef.current = { scopeKey, snapshotId: data.snapshotId }
          setEntries(data.entries)
          setKnownLastPage(data.hasMore ? null : data.page)
        }
        setFetchedKey(`${bracket}:${region}:${page}`)
        setIsLoading(false)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        console.error(`[leaderboard] request version ${requestVersion} failed`, cause)
        setFailed(true)
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [bracket, region, page, preferencesLoading, requestVersion])

  const currentKey = `${bracket}:${region}:${page}`
  const showLoading = isLoading || fetchedKey !== currentKey
  const effectiveMaxPage = knownLastPage ?? MAX_PAGE

  if (failed) {
    return (
      <LeaderboardErrorState
        onRetryAction={() => {
          setFailed(false)
          setIsLoading(true)
          setRequestVersion((version) => version + 1)
        }}
      />
    )
  }

  return (
    <Card className="w-full max-w-5xl mx-auto mt-12 bg-card/50 backdrop-blur-xs border-border">
      <div className="p-6 border-b border-border flex flex-col sm:flex-row justify-between items-center gap-4">
        <h2 className="text-2xl font-bold text-card-foreground flex items-center gap-2">
          <span className="text-yellow-500">&#127942;</span> Leaderboard
        </h2>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-bold uppercase">Bracket:</span>
            <Select
              value={bracket}
              disabled={accountLoading || preferencesSaving}
              onValueChange={(v) => updateFilters({ bracket: v as BracketId, page: 1 })}
            >
              <SelectTrigger aria-label="Leaderboard bracket" className="w-[120px] font-bold">
                <SelectValue placeholder="Bracket" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {BRACKETS.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="cursor-pointer">
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-bold uppercase">Region:</span>
            <Select
              value={region}
              disabled={accountLoading || preferencesSaving}
              onValueChange={(v) => updateFilters({ region: v as RegionId, page: 1 })}
            >
              <SelectTrigger aria-label="Leaderboard region" className="w-[180px] font-bold">
                <SelectValue placeholder="Select Region" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {REGIONS.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="cursor-pointer">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PaginationControls
            page={page}
            isLoading={showLoading}
            onPageChange={(p) => updateFilters({ page: p })}
            maxPage={effectiveMaxPage}
            compact
          />
        </div>
      </div>

      {snapshotNotice(snapshotStatus) && (
        <output
          className={`block px-6 py-3 border-b text-sm ${snapshotStatus === 'stale' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-border bg-muted/30 text-muted-foreground'}`}
        >
          <span className="font-semibold">{snapshotNotice(snapshotStatus)}</span>
        </output>
      )}
      {preferenceError && (
        <output className="block border-b border-border px-6 py-2 text-sm text-amber-300">{preferenceError}</output>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-20 text-center font-bold">Rank</TableHead>
              <TableHead className="font-bold">{bracket === '2v2' ? 'Team' : 'Player'}</TableHead>
              <TableHead className="text-center font-bold">Rating</TableHead>
              <TableHead className="text-center font-bold">Win Rate</TableHead>
              <TableHead className="text-center font-bold hidden sm:table-cell">Wins</TableHead>
              <TableHead className="text-center font-bold hidden sm:table-cell">Games</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {showLoading ? (
              <LeaderboardSkeletonRows />
            ) : snapshotStatus === 'unavailable' ? (
              <TableRow className="border-border hover:bg-transparent">
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  {snapshotNotice('unavailable')}
                </TableCell>
              </TableRow>
            ) : entries.length > 0 ? (
              entries.map((entry) => {
                if (isTeamEntry(entry)) {
                  const [first, second] = entry.identity.players
                  return <TeamLeaderboardRow key={`${first.brawlhallaId}-${second.brawlhallaId}`} entry={entry} />
                }
                return <SoloLeaderboardRow key={entry.identity.player.brawlhallaId} entry={entry} />
              })
            ) : (
              <TableRow className="border-border hover:bg-transparent">
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  {bracket === '2v2' ? 'No teams found for this region.' : 'No players found for this region.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="p-4 border-t border-border flex justify-center items-center bg-muted/20">
        <PaginationControls
          page={page}
          isLoading={showLoading}
          onPageChange={(p) => updateFilters({ page: p })}
          maxPage={effectiveMaxPage}
        />
      </div>
    </Card>
  )
}
