'use client'

import { getClanAction, refreshClanAction } from '@/app/clan/[id]/actions'
import { NavBar } from '@/components/NavBar'
import { TurnstileGate } from '@/components/TurnstileGate'
import { fixEncoding, formatNum, timeAgo } from '@/lib/utils'
import { CLAN_TTL_MS } from '@brawltome/shared/constants'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
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
import { Calendar, Clock, Crown, Search, Shield, TrendingUp, Trophy, User, UserPlus, Users } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

const PAGE_SIZE = 25

// biome-ignore lint/suspicious/noExplicitAny: dynamic API response
type ClanData = any

interface ClanProfileProps {
  initialData: ClanData | null
  id: string
}

const getRankIcon = (rank: string) => {
  switch (rank.toLowerCase()) {
    case 'leader':
      return <Crown className="w-5 h-5 text-yellow-500" />
    case 'officer':
      return <Shield className="w-4 h-4 text-blue-400 fill-current" />
    case 'member':
      return <User className="w-4 h-4 text-success" />
    case 'recruit':
      return <UserPlus className="w-4 h-4 text-muted-foreground/50" />
    default:
      return <User className="w-4 h-4 text-muted-foreground" />
  }
}

const getRankValue = (rank: string) => {
  switch (rank.toLowerCase()) {
    case 'leader':
      return 4
    case 'officer':
      return 3
    case 'member':
      return 2
    case 'recruit':
      return 1
    default:
      return 0
  }
}

export function ClanProfile({ initialData, id }: ClanProfileProps) {
  const [clan, setClan] = useState<ClanData | null>(initialData)
  const [page, setPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'default' | 'xp'>('default')
  const isDiscovery = !initialData
  const isStale = initialData ? Date.now() - new Date(initialData.lastUpdated).getTime() > CLAN_TTL_MS : false
  const [refreshing, setRefreshing] = useState(isStale)
  const [turnstileError, setTurnstileError] = useState(false)
  const tokenHandled = useRef(false)
  const refreshBaseline = useRef<number | null>(new Date(initialData?.lastUpdated ?? 0).getTime() || null)

  const handleToken = useCallback(
    async (token: string) => {
      if (tokenHandled.current) return
      tokenHandled.current = true
      try {
        refreshBaseline.current = new Date(clan?.lastUpdated ?? 0).getTime() || null
        const result = await refreshClanAction(Number(id), token)
        if (result?.isRefreshing) setRefreshing(true)
        if (!clan) {
          const data = await getClanAction(Number(id))
          if (data) setClan(data)
        }
      } catch {
        tokenHandled.current = false // Allow retry on failure
      }
    },
    [id, clan],
  )

  // Poll while refreshing
  useEffect(() => {
    if (!refreshing) return
    const intervalId = setInterval(async () => {
      try {
        const data = await getClanAction(Number(id))
        if (data) {
          setClan(data)
          const currentTimestamp = new Date(data.lastUpdated ?? 0).getTime() || null
          const discoveryDone = isDiscovery && (data.members?.length ?? 0) > 0 && data.clanName !== `Clan ${id}`
          const refreshDone = !isDiscovery && currentTimestamp !== null && currentTimestamp !== refreshBaseline.current
          if (discoveryDone || refreshDone) {
            setRefreshing(false)
            clearInterval(intervalId)
          }
        }
      } catch {
        /* ignore */
      }
    }, 2000)
    const timeout = setTimeout(() => {
      setRefreshing(false)
      clearInterval(intervalId)
    }, 30000)
    return () => {
      clearInterval(intervalId)
      clearTimeout(timeout)
    }
  }, [refreshing, id, isDiscovery])

  // If refresh timed out and we still have no data, show error
  useEffect(() => {
    if (!refreshing && !clan && tokenHandled.current) {
      setTurnstileError(true)
    }
  }, [refreshing, clan])

  const turnstile = <TurnstileGate onToken={handleToken} onError={() => setTurnstileError(true)} />

  if (!clan) {
    return (
      <div className="max-w-6xl mx-auto p-6 pt-3 sm:pt-6">
        <NavBar showBack />
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          {!turnstileError && (
            <>
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <p>Looking up clan...</p>
            </>
          )}
          {turnstileError && <p>Clan not found.</p>}
          {turnstile}
        </div>
      </div>
    )
  }

  const members = clan.members || []

  const filteredMembers = members.filter(
    (m: ClanData) =>
      !searchTerm ||
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(m.brawlhallaId).includes(searchTerm),
  )

  const sortedMembers = [...filteredMembers].sort((a: ClanData, b: ClanData) => {
    if (sortBy === 'xp') return (b.xp ?? 0) - (a.xp ?? 0)
    const rankDiff = getRankValue(b.rank) - getRankValue(a.rank)
    if (rankDiff !== 0) return rankDiff
    return new Date(a.joinDate).getTime() - new Date(b.joinDate).getTime()
  })

  const totalPages = Math.ceil(sortedMembers.length / PAGE_SIZE)
  const paginatedMembers = sortedMembers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const formatJoinedDate = (value: string | Date) => {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
  }

  return (
    <div className="max-w-6xl mx-auto p-6 pt-3 sm:pt-6 space-y-8">
      {turnstile}
      <NavBar showBack />

      {/* Header */}
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-4xl sm:text-6xl font-black text-foreground tracking-tight">
            {fixEncoding(clan.clanName)}
          </h1>
          <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-mono">ID: {id}</span>
            </div>
            <span>•</span>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>Created {new Date(clan.clanCreateDate).toLocaleDateString()}</span>
            </div>
            {clan.lastUpdated && (
              <>
                <span>•</span>
                <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5">
                  <Clock className="w-3 h-3" />
                  Updated {timeAgo(clan.lastUpdated)}
                </Badge>
              </>
            )}
            {refreshing && (
              <>
                <span>•</span>
                <Badge variant="secondary" className="gap-2 animate-pulse">
                  <div className="w-2 h-2 bg-primary rounded-full animate-ping" />
                  Syncing live data...
                </Badge>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total XP</CardTitle>
              <Trophy className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNum(clan.clanXp)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Members</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNum(members.length)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Average XP</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {members.length > 0 ? formatNum(Math.round(Number(clan.clanXp ?? 0) / members.length)) : '0'}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Members */}
      <Card className="bg-card/50 backdrop-blur-xs border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-yellow-500">&#127942;</span> Clan Members
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-bold uppercase">Sort:</span>
              <Select
                value={sortBy}
                onValueChange={(v) => {
                  setSortBy(v as typeof sortBy)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-[140px] font-bold h-9">
                  <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default" className="cursor-pointer">
                    Clan Rank
                  </SelectItem>
                  <SelectItem value="xp" className="cursor-pointer">
                    XP
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search members..."
                className="pl-8 h-9"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setPage(1)
                }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-[60px] font-bold text-center">Rank</TableHead>
                <TableHead className="font-bold">Player</TableHead>
                <TableHead className="text-right font-bold">XP / Contribution</TableHead>
                <TableHead className="text-right font-bold hidden sm:table-cell">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedMembers.map((member: ClanData) => {
                const totalClanXp = Number(clan.clanXp) || 1
                const contribution = (member.xp / totalClanXp) * 100
                const href = `/player/${member.brawlhallaId}`
                return (
                  <TableRow
                    key={member.brawlhallaId}
                    className="border-border hover:bg-muted/50 transition-colors h-16 group"
                  >
                    <TableCell className="p-0">
                      <Link href={href} prefetch={false} className="block w-full h-full p-4">
                        <div className="flex items-center justify-center">{getRankIcon(member.rank)}</div>
                      </Link>
                    </TableCell>
                    <TableCell className="p-0">
                      <Link href={href} prefetch={false} className="block w-full h-full p-4">
                        <span className="font-bold text-lg text-foreground group-hover:text-primary transition-colors">
                          {fixEncoding(member.name)}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="p-0 text-right font-mono">
                      <Link href={href} prefetch={false} className="block w-full h-full p-4">
                        <div className="flex flex-col items-end leading-tight">
                          <span className="font-bold">{formatNum(member.xp)}</span>
                          <span className="text-xs text-muted-foreground">{contribution.toFixed(1)}%</span>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="p-0 text-right text-muted-foreground text-sm hidden sm:table-cell">
                      <Link href={href} prefetch={false} className="block w-full h-full p-4">
                        {formatJoinedDate(member.joinDate)}
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
        {totalPages > 1 && (
          <div className="p-4 border-t border-border flex justify-between items-center bg-muted/20">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-mono">Page</span>
              <Input
                key={page}
                defaultValue={page}
                className="h-8 w-16 text-center font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = Number.parseInt(e.currentTarget.value)
                    if (!Number.isNaN(val) && val >= 1 && val <= totalPages) setPage(val)
                  }
                }}
              />
              <span className="text-sm text-muted-foreground font-mono">of {totalPages}</span>
            </div>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next →
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
