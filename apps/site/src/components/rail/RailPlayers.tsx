import { Link } from '@tanstack/react-router'
import type { FocusEvent, PointerEvent, ReactNode } from 'react'
import { playerLabel } from '../account/account-model'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { type RailAccount, type RailPlayer, railPlayers } from './rail-account'
import { railTooltipLook } from './rail-tooltip'

// the list scrolls, which would clip a tooltip inside it, so the tooltip is fixed beside the rail at the link's height
const tooltipStyle = `fixed top-(--tooltip-top) left-15 -translate-y-1/2 ${railTooltipLook}`

function placeTooltip(event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) {
  const box = event.currentTarget.getBoundingClientRect()

  event.currentTarget.style.setProperty('--tooltip-top', `${box.top + box.height / 2}px`)
}

type ShortcutProps = {
  player: RailPlayer
  isVerified: boolean
  onClose?: () => void
  className: string
  activeClassName: string
}

function accessibleLabel(player: RailPlayer, isVerified: boolean): string {
  return `${isVerified ? 'Your account' : 'Pinned player'}, ${playerLabel(player)}`
}

// a hover over the rail is no sign of intent, and each preloaded player page is several reads
function PlayerShortcut(props: ShortcutProps & { children: ReactNode }) {
  const { player, isVerified, onClose, className, activeClassName, children } = props

  return (
    <Link
      to="/player/$id"
      params={{ id: String(player.brawlhallaId) }}
      preload={false}
      aria-label={accessibleLabel(player, isVerified)}
      activeProps={{ className: activeClassName }}
      onClick={onClose}
      onPointerEnter={placeTooltip}
      onFocus={placeTooltip}
      className={className}
    >
      {children}
    </Link>
  )
}

function LegendPicture({ player }: { player: RailPlayer }) {
  return (
    <img
      src={legendAvatarUrl(player.legendNameKey)}
      alt=""
      className="size-8 shrink-0 rounded-md bg-raised object-cover object-top"
    />
  )
}

function shortcutsOf(account: RailAccount) {
  if (account.kind === 'signedOut') return []

  const verifiedId = account.verifiedPlayer?.brawlhallaId

  return railPlayers(account).map((player) => ({ player, isVerified: player.brawlhallaId === verifiedId }))
}

/** The visitor's verified account and pinned players as shortcuts in the rail, like on the old site. */
export function RailPlayers({ account }: { account: RailAccount }) {
  const shortcuts = shortcutsOf(account)

  if (shortcuts.length === 0) return null

  return (
    <ul aria-label="Player shortcuts">
      {shortcuts.map(({ player, isVerified }) => (
        <li key={player.brawlhallaId}>
          <PlayerShortcut
            player={player}
            isVerified={isVerified}
            activeClassName="bg-white/[0.08]"
            className="group my-2 flex size-10 items-center justify-center rounded-control transition-colors hover:bg-white/[0.04]"
          >
            <LegendPicture player={player} />
            <span className={tooltipStyle}>{playerLabel(player)}</span>
          </PlayerShortcut>
        </li>
      ))}
    </ul>
  )
}

/** The same shortcuts in the mobile menu, with the names written out. */
export function MenuPlayers({ account, onClose }: { account: RailAccount; onClose: () => void }) {
  const shortcuts = shortcutsOf(account)

  if (shortcuts.length === 0) return null

  return (
    <ul aria-label="Player shortcuts" className="mt-6">
      {shortcuts.map(({ player, isVerified }) => (
        <li key={player.brawlhallaId} className="border-b border-line/40 last:border-b-0">
          <PlayerShortcut
            player={player}
            isVerified={isVerified}
            onClose={onClose}
            activeClassName="!text-strong"
            className="flex h-12 items-center gap-4 font-semibold text-soft transition-colors hover:text-strong"
          >
            <LegendPicture player={player} />
            <span className="truncate">{playerLabel(player)}</span>
          </PlayerShortcut>
        </li>
      ))}
    </ul>
  )
}
