'use client'

import { fixEncoding } from '@/lib/utils'
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
import type { PlayerData } from '../shared'
import { formatHours } from '../shared'
import { StaleBadge } from './StaleBadge'

interface ProfileHeaderProps {
  player: PlayerData
  topLegend: PlayerData | null
  aliases: string[]
  refreshing: boolean
}

export function ProfileHeader({ player, topLegend, aliases, refreshing }: ProfileHeaderProps) {
  return (
    <div id="overview" className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div className="flex items-center gap-6 min-w-0 w-full md:w-auto md:flex-1">
        {topLegend && (
          <Avatar className="h-20 w-20 sm:h-24 sm:w-24 border-4 border-card rounded-2xl shrink-0">
            <AvatarImage
              src={`/images/legends/avatars/${topLegend.legendNameKey}.png`}
              alt={topLegend.legendNameKey}
              className="object-cover object-top"
            />
            <AvatarFallback className="bg-muted text-xl sm:text-3xl font-bold text-muted-foreground capitalize rounded-2xl">
              {topLegend.legendNameKey?.[0] || '?'}
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

      {refreshing && <StaleBadge />}
    </div>
  )
}
