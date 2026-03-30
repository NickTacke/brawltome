'use client'

import { getPlayerAction, refreshPlayerAction } from '@/app/player/[id]/actions'
import { NavBar } from '@/components/NavBar'
import { TurnstileGate } from '@/components/TurnstileGate'
import { fixEncoding, formatNum } from '@/lib/utils'
import { aggregateRichWeaponStats } from '@/lib/weapon-aggregation'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@brawltome/ui'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CombatCard } from './CombatCard'
import { LegendSection } from './LegendSection'
import { RankedCard } from './RankedCard'
import { RatingChart } from './RatingChart'
import { TeamSection } from './TeamSection'
import { WeaponSection } from './WeaponSection'
import { formatHours } from './shared'

// biome-ignore lint/suspicious/noExplicitAny: tRPC inferred type
type PlayerData = any

interface PlayerProfileProps {
  initialData: PlayerData | null
  id: string
}

export function PlayerProfile({ initialData, id }: PlayerProfileProps) {
  const [player, setPlayer] = useState<PlayerData | null>(initialData)
  const [refreshing, setRefreshing] = useState(false)
  const [turnstileError, setTurnstileError] = useState(false)
  const tokenHandled = useRef(false)

  const handleToken = useCallback(
    async (token: string) => {
      if (tokenHandled.current) return
      tokenHandled.current = true
      try {
        const result = await refreshPlayerAction(Number(id), token)
        if (result?.isRefreshing) setRefreshing(true)
        if (!player) {
          const data = await getPlayerAction(Number(id))
          if (data) setPlayer(data)
        }
      } catch {
        /* ignore — data still shows from initial load */
      }
    },
    [id, player],
  )

  // Poll while refreshing
  useEffect(() => {
    if (!refreshing) return
    const intervalId = setInterval(async () => {
      try {
        const data = await getPlayerAction(Number(id))
        if (data) {
          setPlayer(data)
          const isPlaceholder = data.name === `Player ${id}` && data.rating === 0
          if (!isPlaceholder) {
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
  }, [refreshing, id])

  const weaponStats = useMemo(
    () => (player ? aggregateRichWeaponStats(player.statsLegends || [], player.rankedLegends || []) : []),
    [player],
  )

  const turnstile = <TurnstileGate onToken={handleToken} onError={() => setTurnstileError(true)} />

  if (!player) {
    return (
      <div className="max-w-6xl mx-auto p-6 pt-3 sm:pt-6">
        <NavBar showBack />
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          {!turnstileError && (
            <>
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <p>Looking up player...</p>
            </>
          )}
          {turnstileError && <p>Player not found.</p>}
          {turnstile}
        </div>
      </div>
    )
  }

  const allLegends = [...(player.statsLegends || [])].sort((a: PlayerData, b: PlayerData) => (b.xp ?? 0) - (a.xp ?? 0))
  const rankedTeams = [...(player.rankedTeams || [])].sort(
    (a: PlayerData, b: PlayerData) => (b.rating ?? 0) - (a.rating ?? 0),
  )

  const aliases: string[] = (player.aliases || [])
    .map((a: PlayerData) => a?.value)
    .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
    .filter((v: string) => v.trim() !== player.name)
    .sort((a: string, b: string) => a.localeCompare(b))

  return (
    <div className="max-w-6xl mx-auto p-6 pt-3 sm:pt-6 space-y-8">
      {turnstile}
      {/* Top Navbar */}
      <NavBar showBack />

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-6 min-w-0 w-full md:w-auto md:flex-1">
          {/* Best Legend Avatar */}
          {allLegends.length > 0 && (
            <Avatar className="h-20 w-20 sm:h-24 sm:w-24 border-4 border-card rounded-2xl shrink-0">
              <AvatarImage
                src={`/images/legends/avatars/${allLegends[0].legendNameKey}.png`}
                alt={allLegends[0].legendNameKey}
                className="object-cover object-top"
              />
              <AvatarFallback className="bg-muted text-xl sm:text-3xl font-bold text-muted-foreground capitalize rounded-2xl">
                {allLegends[0].legendNameKey?.[0] || '?'}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-5xl sm:h-14 font-black text-foreground tracking-tight truncate">
              {fixEncoding(player.name)}
            </h1>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
              {player.region && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{player.region}</Badge>
                </div>
              )}
              <span>&bull;</span>
              <div>
                ID: <span className="font-mono text-foreground">{player.brawlhallaId}</span>
              </div>
              {player.matchTimeTotal > 0 && (
                <>
                  <span>&bull;</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Playtime:</span>
                    <span className="font-mono text-foreground">{formatHours(player.matchTimeTotal)}</span>
                  </div>
                </>
              )}
              {aliases.length > 0 && (
                <>
                  <span>&bull;</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        Aliases ({aliases.length})
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="max-h-[198px] overflow-y-auto pb-0 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent"
                    >
                      {aliases.map((alias: string, idx: number) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: aliases can contain duplicates
                        <DropdownMenuItem key={`${alias}-${idx}`}>{fixEncoding(alias)}</DropdownMenuItem>
                      ))}
                      {aliases.length > 5 && (
                        <div className="sticky bottom-0 h-5 bg-gradient-to-t from-popover to-transparent pointer-events-none -mt-5" />
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
              {player.clan && (
                <>
                  <span>&bull;</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Clan:</span>
                    <Link
                      href={`/clan/${player.clan.clanId}`}
                      prefetch={false}
                      className="text-primary font-bold hover:underline"
                    >
                      {fixEncoding(player.clan.clanName)}
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {refreshing && (
          <Badge variant="secondary" className="gap-2 animate-pulse">
            <div className="w-2 h-2 bg-primary rounded-full animate-ping" />
            Syncing live data...
          </Badge>
        )}
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RankedCard player={player} rankedTeams={rankedTeams} />
        <CombatCard player={player} />
      </div>

      {/* Rating History Chart */}
      {player.ratingHistory && player.ratingHistory.length > 0 && <RatingChart data={player.ratingHistory} />}

      {/* Weapon Statistics */}
      <WeaponSection weaponStats={weaponStats} />

      {/* Legend Statistics */}
      <LegendSection allLegends={allLegends} rankedLegends={player.rankedLegends || []} />

      {/* 2v2 Teams */}
      <TeamSection player={player} rankedTeams={rankedTeams} id={id} />
    </div>
  )
}
