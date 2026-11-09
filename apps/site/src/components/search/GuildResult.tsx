import type { DiscoveryClanHitContract } from '@brawltome/contracts'
import { Link } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { fixEncoding, formatWhole } from '../../lib'
import { HighlightedText } from './HighlightedText'
import { activeResultRowStyle, resultRowStyle } from './search-styles'

type GuildResultProps = { guild: DiscoveryClanHitContract; query: string; isActive: boolean; onOpen: () => void }

export function GuildResult({ guild, query, isActive, onOpen }: GuildResultProps) {
  return (
    <Link
      to="/guild/$id"
      params={{ id: String(guild.clanId) }}
      onClick={onOpen}
      data-active={isActive}
      className={`${resultRowStyle} ${isActive ? activeResultRowStyle : ''}`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center text-soft">
          <Users className="size-5" aria-hidden="true" />
        </span>
        <span className="truncate font-semibold text-strong">
          <HighlightedText text={fixEncoding(guild.clanName)} query={query} />
        </span>
        <span className="shrink-0 text-sm text-soft">{formatWhole(guild.memberCount)} members</span>
      </span>
      <span className="shrink-0 font-mono text-soft">{formatWhole(guild.clanXp)} XP</span>
    </Link>
  )
}
