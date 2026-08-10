'use client'

import { fixEncoding } from '@/lib/utils'
import { Badge, TableCell, TableRow } from '@brawltome/ui'
import Link from 'next/link'
import { type SoloLeaderboardEntry, type TeamLeaderboardEntry, getRankStyle, playerHref } from './utils'

function SourceRank({ standing, sourceRank }: { standing: number; sourceRank: number }) {
  return sourceRank !== standing ? (
    <span className="text-[10px] font-normal text-muted-foreground">Source #{sourceRank}</span>
  ) : null
}

function PlayerLink({ brawlhallaId, name }: { brawlhallaId: number; name: string }) {
  const href = playerHref(brawlhallaId)
  return href ? (
    <Link href={href} prefetch={false} className="hover:text-primary">
      {fixEncoding(name)}
    </Link>
  ) : (
    <span>{fixEncoding(name)}</span>
  )
}

export function SoloLeaderboardRow({ entry }: { entry: SoloLeaderboardEntry }) {
  const winrate = entry.games > 0 ? (entry.wins / entry.games) * 100 : null
  const player = entry.identity.player
  const href = playerHref(player.brawlhallaId)
  const content = (children: React.ReactNode) =>
    href ? (
      <Link href={href} prefetch={false} className="block w-full h-full p-4">
        {children}
      </Link>
    ) : (
      <div className="block w-full h-full p-4">{children}</div>
    )

  return (
    <TableRow className="border-border cursor-pointer transition-colors group h-16">
      <TableCell className={`p-0 text-center ${getRankStyle(entry.standing)}`}>
        {content(
          <span className="flex flex-col items-center">
            <span>#{entry.standing}</span>
            <SourceRank standing={entry.standing} sourceRank={entry.sourceRank} />
          </span>,
        )}
      </TableCell>
      <TableCell className="p-0">
        {content(
          <div className="flex flex-col">
            <span className="font-bold text-foreground group-hover:text-primary transition-colors text-base truncate max-w-[200px]">
              {fixEncoding(player.name)}
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
          </div>,
        )}
      </TableCell>
      <TableCell className="p-0 text-center">
        {content(
          <div className="flex flex-col items-center">
            <span className="font-black text-foreground text-lg tracking-tight">{entry.rating}</span>
            <span className="text-[10px] text-muted-foreground uppercase font-bold">
              Peak: {entry.peakRating ?? '---'}
            </span>
          </div>,
        )}
      </TableCell>
      <TableCell className="p-0 text-center">
        {content(
          <div
            className={`font-bold ${winrate !== null && winrate >= 60 ? 'text-success' : winrate !== null && winrate >= 50 ? 'text-primary' : 'text-muted-foreground'}`}
          >
            {winrate === null ? '---' : `${winrate.toFixed(1)}%`}
          </div>,
        )}
      </TableCell>
      <TableCell className="p-0 text-center hidden sm:table-cell text-muted-foreground font-mono">
        {content(entry.wins)}
      </TableCell>
      <TableCell className="p-0 text-center hidden sm:table-cell text-muted-foreground font-mono">
        {content(entry.games)}
      </TableCell>
    </TableRow>
  )
}

export function TeamLeaderboardRow({ entry }: { entry: TeamLeaderboardEntry }) {
  const winrate = entry.games > 0 ? (entry.wins / entry.games) * 100 : 0
  const [first, second] = entry.identity.players
  return (
    <TableRow className="border-border transition-colors group h-16">
      <TableCell className={`text-center ${getRankStyle(entry.standing)}`}>
        <span className="flex flex-col items-center">
          <span>#{entry.standing}</span>
          <SourceRank standing={entry.standing} sourceRank={entry.sourceRank} />
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <div className="font-bold text-foreground text-base max-w-[420px] md:max-w-[560px] whitespace-normal leading-tight">
            <PlayerLink brawlhallaId={first.brawlhallaId} name={first.name} />
            <span className="opacity-50"> + </span>
            <PlayerLink brawlhallaId={second.brawlhallaId} name={second.name} />
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
            Peak: {entry.peakRating ?? '---'}
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
