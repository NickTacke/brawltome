'use client'

import { trpc } from '@/lib/trpc'
import { fixEncoding } from '@/lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brawltome/ui'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

const REGIONS = [
  { id: 'all', label: 'Global' },
  { id: 'US-E', label: 'US-E' },
  { id: 'US-W', label: 'US-W' },
  { id: 'EU', label: 'Europe' },
  { id: 'SEA', label: 'SEA' },
  { id: 'AUS', label: 'AUS' },
  { id: 'BRZ', label: 'Brazil' },
  { id: 'JPN', label: 'Japan' },
  { id: 'ME', label: 'Middle East' },
  { id: 'SA', label: 'South Africa' },
]

const BRACKETS = [
  { id: '1v1', label: '1v1' },
  { id: '2v2', label: '2v2' },
] as const

const PAGE_SIZE = 20

type BracketId = '1v1' | '2v2'
type RegionId = 'all' | 'US-E' | 'EU' | 'SEA' | 'BRZ' | 'AUS' | 'US-W' | 'JPN' | 'ME' | 'SA'
type SortField = 'rating' | 'peakRating' | 'wins' | 'games'
type SortOrder = 'asc' | 'desc'

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentOrder,
  onSort,
  className,
}: {
  label: string
  sortKey: string
  currentSort: string
  currentOrder: SortOrder
  onSort: (key: string) => void
  className?: string
}) {
  const isActive = currentSort === sortKey
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-2 w-full hover:text-primary transition-colors font-bold"
      >
        {label}
        {isActive ? (
          currentOrder === 'asc' ? (
            <ArrowUp className="h-4 w-4" />
          ) : (
            <ArrowDown className="h-4 w-4" />
          )
        ) : (
          <ArrowUpDown className="h-4 w-4 opacity-30" />
        )}
      </button>
    </TableHead>
  )
}

function PaginationControls({
  page,
  isLoading,
  onPageChange,
  compact = false,
}: {
  page: number
  isLoading: boolean
  onPageChange: (page: number) => void
  compact?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={page === 1 || isLoading}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        {compact ? '\u2190' : '\u2190 Prev'}
      </Button>
      <div className="flex items-center gap-2">
        {!compact && <span className="text-sm text-muted-foreground font-mono">Page</span>}
        <Input
          key={page}
          defaultValue={page}
          className="h-8 w-16 text-center font-mono"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = Number.parseInt(e.currentTarget.value.trim(), 10)
              if (!Number.isNaN(val) && val >= 1 && val <= 200) onPageChange(val)
              else {
                onPageChange(1)
                e.currentTarget.value = '1'
              }
            }
          }}
        />
        <span className="text-sm text-muted-foreground font-mono">{compact ? '/200' : 'of 200'}</span>
      </div>
      <Button variant="outline" size="sm" disabled={page >= 200 || isLoading} onClick={() => onPageChange(page + 1)}>
        {compact ? '\u2192' : 'Next \u2192'}
      </Button>
    </div>
  )
}

export function Leaderboard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const bracket = (searchParams.get('bracket') || '1v1') as BracketId
  const page = Number.parseInt(searchParams.get('page') || '1', 10)
  const region = (searchParams.get('region') || 'all') as RegionId
  const sortBy = (searchParams.get('sort') || 'rating') as SortField
  const sortOrder = (searchParams.get('order') || 'desc') as SortOrder

  const [entries, setEntries] = useState<unknown[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedKey, setFetchedKey] = useState('')

  const updateQueryParams = useCallback(
    (updates: Record<string, string | number>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, String(value))
        else params.delete(key)
      }
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    trpc.leaderboard.get
      .query({ bracket, region, page, pageSize: PAGE_SIZE, sort: sortBy, order: sortOrder })
      .then((data) => {
        if (cancelled) return
        setEntries(data.entries)
        setFetchedKey(`${bracket}:${region}:${page}:${sortBy}:${sortOrder}`)
        setIsLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [bracket, region, page, sortBy, sortOrder])

  const handleHeaderSort = (key: string) => {
    if (key === sortBy) updateQueryParams({ order: sortOrder === 'desc' ? 'asc' : 'desc', page: 1 })
    else updateQueryParams({ sort: key, order: 'desc', page: 1 })
  }

  const currentKey = `${bracket}:${region}:${page}:${sortBy}:${sortOrder}`
  const showLoading = isLoading || fetchedKey !== currentKey

  const getRankStyle = (rank: number) => {
    if (rank === 1) return 'text-yellow-500 font-black text-xl'
    if (rank === 2) return 'text-slate-400 font-black text-xl'
    if (rank === 3) return 'text-amber-700 font-black text-xl'
    return 'text-muted-foreground font-mono'
  }

  if (error) {
    return (
      <Card className="w-full max-w-4xl mx-auto mt-12 bg-destructive/10 border-destructive text-destructive-foreground p-6 text-center">
        Error loading leaderboard: {error}
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
            <Select value={bracket} onValueChange={(v) => updateQueryParams({ bracket: v, page: 1 })}>
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
            <Select value={region} onValueChange={(v) => updateQueryParams({ region: v, page: 1 })}>
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
            onPageChange={(p) => updateQueryParams({ page: p })}
            compact
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-20 text-center font-bold">Rank</TableHead>
              <TableHead className="font-bold">{bracket === '1v1' ? 'Player' : 'Team'}</TableHead>
              <SortableHeader
                label="Rating"
                sortKey="rating"
                currentSort={sortBy}
                currentOrder={sortOrder}
                onSort={handleHeaderSort}
                className="text-center"
              />
              <TableHead className="text-center font-bold">Win Rate</TableHead>
              <SortableHeader
                label="Wins"
                sortKey="wins"
                currentSort={sortBy}
                currentOrder={sortOrder}
                onSort={handleHeaderSort}
                className="text-center hidden sm:table-cell"
              />
              <SortableHeader
                label="Games"
                sortKey="games"
                currentSort={sortBy}
                currentOrder={sortOrder}
                onSort={handleHeaderSort}
                className="text-center hidden sm:table-cell"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {showLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton loading rows never reorder
                <TableRow key={`skeleton-${i}`} className="border-border hover:bg-transparent">
                  <TableCell className="p-4">
                    <Skeleton className="h-6 w-8 mx-auto" />
                  </TableCell>
                  <TableCell className="p-4">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-3 w-20" />
                  </TableCell>
                  <TableCell className="p-4">
                    <Skeleton className="h-6 w-16 mx-auto" />
                  </TableCell>
                  <TableCell className="p-4">
                    <Skeleton className="h-5 w-12 mx-auto" />
                  </TableCell>
                  <TableCell className="p-4 hidden sm:table-cell">
                    <Skeleton className="h-5 w-10 mx-auto" />
                  </TableCell>
                  <TableCell className="p-4 hidden sm:table-cell">
                    <Skeleton className="h-5 w-10 mx-auto" />
                  </TableCell>
                </TableRow>
              ))
            ) : entries.length > 0 ? (
              bracket === '1v1' ? (
                // biome-ignore lint/suspicious/noExplicitAny: dynamic API response
                entries.map((p: any, i: number) => {
                  const globalRank = (page - 1) * PAGE_SIZE + i + 1
                  const wins = p.rankedWins ?? p.wins ?? 0
                  const games = p.rankedGames ?? p.games ?? 0
                  const winrate = games > 0 ? (wins / games) * 100 : 0
                  const href = `/player/${p.brawlhallaId}`
                  return (
                    <TableRow
                      key={p.brawlhallaId}
                      className="border-border cursor-pointer transition-colors group h-16"
                    >
                      <TableCell className={`p-0 text-center ${getRankStyle(globalRank)}`}>
                        <Link href={href} prefetch={false} className="block w-full h-full p-4">
                          #{globalRank}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        <Link href={href} prefetch={false} className="block w-full h-full p-4">
                          <div className="flex items-center gap-3">
                            {p.bestLegendNameKey && (
                              <Avatar className="h-10 w-10 border border-border bg-muted rounded-md">
                                <AvatarImage
                                  src={`/images/legends/avatars/${p.bestLegendNameKey}.png`}
                                  alt={p.bestLegendNameKey}
                                  className="object-cover object-top"
                                  loading="lazy"
                                />
                                <AvatarFallback className="text-[10px] uppercase font-bold text-muted-foreground rounded-md">
                                  {p.bestLegendNameKey.substring(0, 2)}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <div className="flex flex-col">
                              <span className="font-bold text-foreground group-hover:text-primary transition-colors text-base truncate max-w-[200px]">
                                {fixEncoding(p.name)}
                              </span>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-muted-foreground font-mono">{p.region}</span>
                                {p.tier && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] px-1.5 py-0 h-5 font-normal bg-muted text-muted-foreground border-border"
                                  >
                                    {p.tier}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="p-0 text-center">
                        <Link href={href} prefetch={false} className="block w-full h-full p-4">
                          <div className="flex flex-col items-center">
                            <span className="font-black text-foreground text-lg tracking-tight">{p.rating}</span>
                            <span className="text-[10px] text-muted-foreground uppercase font-bold">
                              Peak: {p.peakRating || '---'}
                            </span>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="p-0 text-center">
                        <Link href={href} prefetch={false} className="block w-full h-full p-4">
                          <div
                            className={`font-bold ${winrate >= 60 ? 'text-success' : winrate >= 50 ? 'text-primary' : 'text-muted-foreground'}`}
                          >
                            {winrate.toFixed(1)}%
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="p-0 text-center hidden sm:table-cell text-muted-foreground font-mono">
                        <Link href={href} prefetch={false} className="block w-full h-full p-4">
                          {wins}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0 text-center hidden sm:table-cell text-muted-foreground font-mono">
                        <Link href={href} prefetch={false} className="block w-full h-full p-4">
                          {games}
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                // biome-ignore lint/suspicious/noExplicitAny: dynamic API response
                entries.map((t: any) => {
                  const winrate = t.games > 0 ? (t.wins / t.games) * 100 : 0
                  return (
                    <TableRow
                      key={`${t.brawlhallaIdOne}-${t.brawlhallaIdTwo}`}
                      className="border-border transition-colors group h-16"
                    >
                      <TableCell className={`text-center ${getRankStyle(t.rank)}`}>#{t.rank}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <div className="font-bold text-foreground text-base max-w-[420px] md:max-w-[560px] whitespace-normal leading-tight">
                            <Link href={`/player/${t.brawlhallaIdOne}`} prefetch={false} className="hover:text-primary">
                              {fixEncoding(t.playerOneName || 'Unknown')}
                            </Link>
                            <span className="opacity-50"> + </span>
                            <Link href={`/player/${t.brawlhallaIdTwo}`} prefetch={false} className="hover:text-primary">
                              {fixEncoding(t.playerTwoName || 'Unknown')}
                            </Link>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground font-mono">
                            <span>{t.region}</span>
                            {t.tier && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 h-5 font-normal bg-muted text-muted-foreground border-border"
                              >
                                {t.tier}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center">
                          <span className="font-black text-foreground text-lg tracking-tight">{t.rating}</span>
                          <span className="text-[10px] text-muted-foreground uppercase font-bold">
                            Peak: {t.peakRating || '---'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div
                          className={`font-bold ${winrate >= 60 ? 'text-success' : winrate >= 50 ? 'text-primary' : 'text-muted-foreground'}`}
                        >
                          {winrate.toFixed(1)}%
                        </div>
                      </TableCell>
                      <TableCell className="text-center hidden sm:table-cell text-muted-foreground font-mono">
                        {t.wins}
                      </TableCell>
                      <TableCell className="text-center hidden sm:table-cell text-muted-foreground font-mono">
                        {t.games}
                      </TableCell>
                    </TableRow>
                  )
                })
              )
            ) : (
              <TableRow className="border-border hover:bg-transparent">
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  {bracket === '1v1' ? 'No players found for this region.' : 'No teams found for this region.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="p-4 border-t border-border flex justify-center items-center bg-muted/20">
        <PaginationControls page={page} isLoading={showLoading} onPageChange={(p) => updateQueryParams({ page: p })} />
      </div>
    </Card>
  )
}
