'use client'

import { formatDate } from '@/lib/format'
import { fixEncoding, formatNum, timeAgo } from '@/lib/utils'
import type { ClanProfileContract } from '@brawltome/contracts'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@brawltome/ui'
import { Calendar, Clock, TrendingUp, Trophy, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

interface ClanHeaderProps {
  clan: ClanProfileContract
  id: string
  memberCount: number
  refreshing: boolean
}

export function ClanHeader({ clan, id, memberCount, refreshing }: ClanHeaderProps) {
  const [relativeUpdated, setRelativeUpdated] = useState<string | null>(null)
  const updateDelayed =
    clan.profile.checkedAt !== null &&
    clan.profile.lastSuccessAt !== null &&
    new Date(clan.profile.checkedAt).getTime() > new Date(clan.profile.lastSuccessAt).getTime()

  useEffect(() => {
    if (!clan.profile.lastSuccessAt) return
    setRelativeUpdated(timeAgo(clan.profile.lastSuccessAt))
    const intervalId = setInterval(() => setRelativeUpdated(timeAgo(clan.profile.lastSuccessAt as string)), 60_000)
    return () => clearInterval(intervalId)
  }, [clan.profile.lastSuccessAt])

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
          {clan.profile.lastSuccessAt && relativeUpdated !== null && (
            <>
              <span>•</span>
              <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5">
                <Clock className="w-3 h-3" />
                Updated {relativeUpdated}
              </Badge>
            </>
          )}
          {updateDelayed && (
            <>
              <span>•</span>
              <Badge variant="outline">Update delayed</Badge>
            </>
          )}
          {!clan.profile.lastSuccessAt && (
            <>
              <span>•</span>
              <Badge variant="outline">Freshness unavailable</Badge>
            </>
          )}
          {refreshing && (
            <>
              <span>•</span>
              <Badge variant="secondary" className="gap-2 animate-pulse">
                <div className="w-2 h-2 bg-primary rounded-full animate-ping" />
                Updating...
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
              {memberCount > 0 ? formatNum(BigInt(clan.clanXp) / BigInt(memberCount)) : 'Unavailable'}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
