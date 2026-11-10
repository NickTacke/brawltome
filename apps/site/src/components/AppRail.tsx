import { BookBookmark, Cup, Gamepad, PieChart, UsersGroupRounded } from '@solar-icons/react'
import { Link } from '@tanstack/react-router'
import type { ComponentType, SVGProps } from 'react'
import { leavesThisApp } from './rail/AccountLink'
import { RailAccountLink } from './rail/RailAccountLink'
import { RailPlayers } from './rail/RailPlayers'
import { railTooltipLook } from './rail/rail-tooltip'
import { useRailAccount } from './rail/use-rail-account'
import { HouseOutline } from './rail-icons'
import { socialLinks } from './social-links'

type RailIcon = ComponentType<SVGProps<SVGSVGElement> & { weight?: string }>
type RailItem = { to: string; label: string; icon: RailIcon; exact?: boolean; wip?: boolean }

export const railItems: RailItem[] = [
  { to: '/', label: 'Home', icon: HouseOutline, exact: true },
  { to: '/stats', label: 'Statistics', icon: PieChart as RailIcon, wip: true },
  { to: '/matches', label: 'Matches', icon: Gamepad as RailIcon, wip: true },
  { to: '/queue', label: 'Queue', icon: UsersGroupRounded as RailIcon },
  { to: '/learn', label: 'Learn', icon: BookBookmark as RailIcon, wip: true },
  { to: '/tournaments', label: 'Tournaments', icon: Cup as RailIcon, wip: true },
]

const tooltipStyle = `absolute left-full ml-3 ${railTooltipLook}`

export function RailLink({ to, label, icon: Icon, exact, wip }: RailItem) {
  return (
    <Link
      to={to}
      {...leavesThisApp}
      aria-label={wip ? `${label} (Soon)` : label}
      activeOptions={{ exact: exact ?? false, includeSearch: false }}
      activeProps={{ className: 'bg-white/[0.08] !text-text' }}
      className={`group relative my-2 flex size-10 items-center justify-center rounded-control text-soft transition-colors hover:bg-white/[0.04] hover:text-text ${wip ? 'opacity-60 hover:opacity-80' : ''}`}
    >
      <Icon className="size-6" weight="Linear" aria-hidden="true" />
      <span className={tooltipStyle}>{`${label}${wip ? ' (Soon)' : ''}`}</span>
    </Link>
  )
}

function RailSocialLinks() {
  return (
    <div className="mb-2">
      {socialLinks.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={link.label}
          className="my-1 flex size-10 items-center justify-center rounded-control text-soft transition-colors hover:bg-white/[0.04] hover:text-text"
        >
          {link.svg}
        </a>
      ))}
    </div>
  )
}

export function AppRail() {
  const account = useRailAccount()

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[57px] flex-col border-r border-line bg-rail md:flex">
      <nav className="shrink-0 px-2 py-1">
        {railItems.map((item) => (
          <RailLink key={item.to} {...item} />
        ))}
      </nav>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-t border-line px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <RailPlayers account={account} />
      </div>
      <div className="shrink-0 border-t border-line px-2 py-2">
        <RailSocialLinks />
        <div className="border-t border-line pt-2 pb-1">
          <RailAccountLink account={account} />
        </div>
      </div>
    </aside>
  )
}
