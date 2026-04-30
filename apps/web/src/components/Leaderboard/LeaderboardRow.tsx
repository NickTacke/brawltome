'use client'

import { fixEncoding } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage, Badge, TableCell, TableRow } from '@brawltome/ui'
import Link from 'next/link'
import { type SoloLeaderboardEntry, type TeamLeaderboardEntry, getRankStyle } from './utils'

interface SoloRowProps {
  entry: SoloLeaderboardEntry
  rank: number
}

export function SoloLeaderboardRow({ entry, rank }: SoloRowProps) {
  const wins = entry.rankedWins ?? entry.wins ?? 0
  const games = entry.rankedGames ?? entry.games ?? 0
  const winrate = games > 0 ? (wins / games) * 100 : 0
  const href = `/player/${entry.brawlhallaId}`
  return (
    <TableRow className="border-border cursor-pointer transition-colors group h-16">
      <TableCell className={`p-0 text-center ${getRankStyle(rank)}`}>
        <Link href={href} prefetch={false} className="block w-full h-full p-4">
          #{rank}
        </Link>
      </TableCell>
      <TableCell className="p-0">
        <Link href={href} prefetch={false} className="block w-full h-full p-4">
          <div className="flex items-center gap-3">
            {entry.bestLegendNameKey && (
              <Avatar className="h-10 w-10 border border-border bg-muted rounded-md">
                <AvatarImage
                  src={`/images/legends/avatars/${entry.bestLegendNameKey}.png`}
                  alt={entry.bestLegendNameKey}
                  className="object-cover object-top"
                  loading="lazy"
                />
                <AvatarFallback className="text-[10px] uppercase font-bold text-muted-foreground rounded-md">
                  {entry.bestLegendNameKey.substring(0, 2)}
                </AvatarFallback>
              </Avatar>
            )}
            <div className="flex flex-col">
              <span className="font-bold text-foreground group-hover:text-primary transition-colors text-base truncate max-w-[200px]">
                {fixEncoding(entry.name)}
              </span>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground font-mono">{entry.region}</span>
                {entry.tier && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-5 font-normal bg-muted text-muted-foreground border-border"
                  >
                    {entry.tier}
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
            <span className="font-black text-foreground text-lg tracking-tight">{entry.rating}</span>
            <span className="text-[10px] text-muted-foreground uppercase font-bold">
              Peak: {entry.peakRating ?? '---'}
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
}

interface TeamRowProps {
  entry: TeamLeaderboardEntry
}

export function TeamLeaderboardRow({ entry }: TeamRowProps) {
  const winrate = entry.games > 0 ? (entry.wins / entry.games) * 100 : 0
  return (
    <TableRow
      key={`${entry.brawlhallaIdOne}-${entry.brawlhallaIdTwo}`}
      className="border-border transition-colors group h-16"
    >
      <TableCell className={`text-center ${getRankStyle(entry.rank)}`}>#{entry.rank}</TableCell>
      <TableCell>
        <div className="flex flex-col">
          <div className="font-bold text-foreground text-base max-w-[420px] md:max-w-[560px] whitespace-normal leading-tight">
            <Link href={`/player/${entry.brawlhallaIdOne}`} prefetch={false} className="hover:text-primary">
              {fixEncoding(entry.playerOneName || 'Unknown')}
            </Link>
            <span className="opacity-50"> + </span>
            <Link href={`/player/${entry.brawlhallaIdTwo}`} prefetch={false} className="hover:text-primary">
              {fixEncoding(entry.playerTwoName || 'Unknown')}
            </Link>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground font-mono">
            <span>{entry.region}</span>
            {entry.tier && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-5 font-normal bg-muted text-muted-foreground border-border"
              >
                {entry.tier}
              </Badge>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-center">
        <div className="flex flex-col items-center">
          <span className="font-black text-foreground text-lg tracking-tight">{entry.rating}</span>
          <span className="text-[10px] text-muted-foreground uppercase font-bold">
            Peak: {entry.peakRating || '---'}
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
      <TableCell className="text-center hidden sm:table-cell text-muted-foreground font-mono">{entry.wins}</TableCell>
      <TableCell className="text-center hidden sm:table-cell text-muted-foreground font-mono">{entry.games}</TableCell>
    </TableRow>
  )
}
