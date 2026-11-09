import type { DiscoveryPlayerHitContract } from '@brawltome/contracts'
import { Link } from '@tanstack/react-router'
import { History } from 'lucide-react'
import { fixEncoding, formatWhole } from '../../lib'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { regionOption } from '../regions'
import { HighlightedText } from './HighlightedText'
import { activeResultRowStyle, resultRowStyle } from './search-styles'

type PlayerResultProps = { player: DiscoveryPlayerHitContract; query: string; isActive: boolean; onOpen: () => void }

function PlayerName({ player, query }: { player: DiscoveryPlayerHitContract; query: string }) {
  const name = fixEncoding(player.name)

  if (player.matchedAlias === null) {
    return (
      <span className="truncate font-semibold text-strong">
        <HighlightedText text={name} query={query} />
      </span>
    )
  }

  return (
    <>
      <span className="truncate font-semibold text-strong">{name}</span>
      <span title="Previous name" className="flex min-w-0 items-center gap-1 text-sm text-soft">
        <History className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{fixEncoding(player.matchedAlias)}</span>
      </span>
    </>
  )
}

export function PlayerResult({ player, query, isActive, onOpen }: PlayerResultProps) {
  const region = regionOption(player.region)
  const rating = player.rating ? formatWhole(player.rating) : '—'

  return (
    <Link
      to="/player/$id"
      params={{ id: String(player.brawlhallaId) }}
      onClick={onOpen}
      data-active={isActive}
      className={`${resultRowStyle} ${isActive ? activeResultRowStyle : ''}`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <img
          src={legendAvatarUrl(player.bestLegendNameKey)}
          alt=""
          className="size-8 shrink-0 rounded-md bg-raised object-cover object-top"
        />
        <PlayerName player={player} query={query} />
      </span>
      <span title={region?.label} className="shrink-0">
        {region?.flag}
      </span>
      <span title="1v1 rating" className="w-12 shrink-0 text-right font-mono font-semibold text-strong">
        {rating}
      </span>
    </Link>
  )
}
