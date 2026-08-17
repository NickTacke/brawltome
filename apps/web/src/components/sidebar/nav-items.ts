import { BookBookmark, Cup, Gamepad, PieChart, UsersGroupRounded } from '@solar-icons/react'
import type { ComponentType, SVGProps } from 'react'

import { HouseOutline } from './icons'

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { weight?: string }>

export interface NavItem {
  icon: NavIcon
  label: string
  href: string
  iconWeight?: string
  wip?: boolean
}

export const navItems: NavItem[] = [
  { icon: HouseOutline, label: 'Home', href: '/' },
  { icon: PieChart as NavIcon, label: 'Statistics', href: '/stats', wip: true },
  { icon: Gamepad as NavIcon, label: 'Matches', href: '/matches', wip: true },
  { icon: BookBookmark as NavIcon, label: 'Learn', href: '/learn', wip: true },
  { icon: Cup as NavIcon, label: 'Tournaments', href: '/tournaments', wip: true },
  { icon: UsersGroupRounded as NavIcon, label: 'Queue', href: '/queue' },
]
