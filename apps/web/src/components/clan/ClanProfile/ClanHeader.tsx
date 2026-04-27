'use client'

import { formatDate } from '@/lib/format'
import { fixEncoding, formatNum, timeAgo } from '@/lib/utils'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@brawltome/ui'
import { Calendar, Clock, TrendingUp, Trophy, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

// biome-ignore lint/suspicious/noExplicitAny: dynamic API response
type ClanData = any

interface ClanHeaderProps {
  clan: ClanData
  id: string
  memberCount: number
  refreshing: boolean
}

export function ClanHeader({ clan, id, memberCount, refreshing }: ClanHeaderProps) {
  const [relativeUpdated, setRelativeUpdated] = useState<string | null>(null)

  useEffect(() => {
    if (!clan.lastUpdated) return
    setRelativeUpdated(timeAgo(clan.lastUpdated))
    const intervalId = setInterval(() => setRelativeUpdated(timeAgo(clan.lastUpdated)), 60_000)
    return () => clearInterval(intervalId)
  }, [clan.lastUpdated])

  return (
    <div id="overview" className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl sm:text-6xl font-black text-foreground tracking-tight">{fixEncoding(clan.clanName)}</h1>
        <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-mono">ID: {id}</span>
          </div>
          <span>•</span>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            <span>Created {formatDate(clan.clanCreateDate)}</span>
          </div>
          {clan.lastUpdated && relativeUpdated !== null && (
            <>
              <span>•</span>
              <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5">
                <Clock className="w-3 h-3" />
                Updated {relativeUpdated}
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
            <div className="text-2xl font-bold">{formatNum(memberCount)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Average XP</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {memberCount > 0 ? formatNum(Math.round(Number(clan.clanXp ?? 0) / memberCount)) : '0'}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
