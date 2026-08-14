'use client'

import { fixEncoding, formatNum } from '@/lib/utils'
import { TableCell, TableRow } from '@brawltome/ui'
import { Crown, Shield, User, UserPlus } from 'lucide-react'
import Link from 'next/link'
import type { ClanMember } from './utils'

const getRankIcon = (rank: string | null) => {
  switch (rank?.toLowerCase()) {
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

const JOIN_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const formatJoinedDate = (value: string | Date | null) =>
  value ? JOIN_DATE_FORMATTER.format(new Date(value)) : 'Unavailable'

interface MemberRowProps {
  member: ClanMember
  totalClanXp: string
}

export function MemberRow({ member, totalClanXp }: MemberRowProps) {
  const name = member.name ? fixEncoding(member.name) : `Player ${member.brawlhallaId}`
  const rank = member.rank ?? 'Unknown'
  const total = BigInt(totalClanXp)
  const contribution = (() => {
    if (total === 0n) return null
    const tenths = (BigInt(member.xp) * 1_000n) / total
    return `${tenths / 10n}.${tenths % 10n}%`
  })()
  const href = `/player/${member.brawlhallaId}`
  return (
    <TableRow className="border-border hover:bg-muted/50 transition-colors h-16 group">
      <TableCell className="p-0">
        <Link
          href={href}
          prefetch={false}
          aria-label={`${name} clan rank: ${rank}`}
          className="block w-full h-full p-4"
        >
          <div className="flex items-center justify-center">{getRankIcon(member.rank)}</div>
        </Link>
      </TableCell>
      <TableCell className="p-0">
        <Link href={href} prefetch={false} className="block w-full h-full p-4">
          <span className="font-bold text-lg text-foreground group-hover:text-primary transition-colors">{name}</span>
        </Link>
      </TableCell>
      <TableCell className="p-0 text-right font-mono">
        <Link href={href} prefetch={false} className="block w-full h-full p-4">
          <div className="flex flex-col items-end leading-tight">
            <span className="font-bold">{formatNum(member.xp)}</span>
            <span className="text-xs text-muted-foreground">{contribution ?? 'Unavailable'}</span>
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
}
