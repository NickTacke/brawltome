'use client'

import { trpc } from '@/lib/trpc'
import {
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
} from '@brawltome/ui'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SoloLeaderboardRow, TeamLeaderboardRow } from './LeaderboardRow'
import { LeaderboardSkeletonRows } from './LeaderboardSkeleton'
import { PaginationControls } from './PaginationControls'
import {
  BRACKETS,
  type BracketId,
  type LeaderboardEntry,
  type LeaderboardFilters,
  MAX_PAGE,
  PAGE_SIZE,
  REGIONS,
  type RegionId,
  buildLeaderboardQueryString,
  displayedSoloStanding,
  isTeamEntry,
  parseLeaderboardSearchParams,
  snapshotNotice,
} from './utils'

export function Leaderboard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const filters = useMemo<LeaderboardFilters>(
    () => parseLeaderboardSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  )
  const { bracket, region, page } = filters

  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedKey, setFetchedKey] = useState('')
  const [knownLastPage, setKnownLastPage] = useState<number | null>(null)
  const [snapshotStatus, setSnapshotStatus] = useState<'fresh' | 'stale' | 'unavailable' | null>(null)
  const [observedAt, setObservedAt] = useState<string | null>(null)
  const snapshotRef = useRef<{ scopeKey: string; snapshotId: string } | null>(null)

  const updateFilters = useCallback(
    (next: Partial<LeaderboardFilters>) => {
      const merged: LeaderboardFilters = { ...filters, ...next }
      const qs = buildLeaderboardQueryString(merged)
      router.push(`${pathname}?${qs}`, { scroll: false })
    },
    [router, pathname, filters],
  )

  useEffect(() => {
    let cancelled = false
    const scopeKey = `${bracket}:${region}`
    const scopeChanged = snapshotRef.current?.scopeKey !== scopeKey
    setIsLoading(true)
    setError(null)
    setKnownLastPage(null)
    if (scopeChanged) {
      snapshotRef.current = null
      setEntries([])
      setSnapshotStatus(null)
      setObservedAt(null)
    }

    const request =
      bracket === '1v1'
        ? trpc.leaderboard.oneVsOne.query({
            bracket,
            region,
            page,
            pageSize: PAGE_SIZE,
            snapshotId: snapshotRef.current?.snapshotId,
          })
        : trpc.leaderboard.get.query({ bracket, region, page, pageSize: PAGE_SIZE })

    request
      .then((data) => {
        if (cancelled) return
        if ('status' in data) {
          setSnapshotStatus(data.status)
          if (data.status === 'unavailable') {
            snapshotRef.current = null
            setEntries([])
            setObservedAt(null)
            setKnownLastPage(data.page)
          } else {
            snapshotRef.current = { scopeKey, snapshotId: data.snapshotId }
            setEntries(data.entries.map((entry) => ({ ...entry, rank: entry.standing })))
            setObservedAt(data.observedAt)
            setKnownLastPage(data.hasMore ? null : data.page)
          }
        } else {
          setSnapshotStatus(null)
          setObservedAt(null)
          setEntries(data.entries as LeaderboardEntry[])
          setKnownLastPage(data.hasMore ? null : data.page)
        }
        setFetchedKey(`${bracket}:${region}:${page}`)
        setIsLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Unknown transport failure')
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [bracket, region, page])

  const currentKey = `${bracket}:${region}:${page}`
  const showLoading = isLoading || fetchedKey !== currentKey
  const effectiveMaxPage = knownLastPage ?? MAX_PAGE

  if (error) {
    return (
      <Card
        role="alert"
        className="w-full max-w-4xl mx-auto mt-12 bg-destructive/10 border-destructive text-destructive-foreground p-6 text-center"
      >
        Unable to load leaderboard data: {error}
      </Card>
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
            <Select value={bracket} onValueChange={(v) => updateFilters({ bracket: v as BracketId, page: 1 })}>
              <SelectTrigger className="w-[120px] font-bold">
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
            <Select value={region} onValueChange={(v) => updateFilters({ region: v as RegionId, page: 1 })}>
              <SelectTrigger className="w-[180px] font-bold">
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
          {observedAt && <span className="ml-2">Observed {new Date(observedAt).toLocaleString()}.</span>}
        </output>
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
              entries.map((entry, i) => {
                if (isTeamEntry(entry)) {
                  return <TeamLeaderboardRow key={`${entry.brawlhallaIdOne}-${entry.brawlhallaIdTwo}`} entry={entry} />
                }
                const standing = displayedSoloStanding(bracket, entry, page, i)
                return <SoloLeaderboardRow key={entry.brawlhallaId} entry={entry} rank={standing} />
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
