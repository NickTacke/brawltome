import { BookBookmark, Cup, Gamepad, PieChart, UsersGroupRounded } from '@solar-icons/react'
import type { ComponentType, SVGProps } from 'react'

import { HouseOutline } from './icons'
import { type ShellHref, parseNavigationContract } from './navigation-contract'
import navigation from './navigation.json'

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { weight?: string }>

export interface NavItem {
  icon: NavIcon
  label: string
  href: string
  iconWeight?: string
  wip?: boolean
}

const iconsByHref: Record<ShellHref, NavIcon> = {
  '/': HouseOutline,
  '/stats': PieChart as NavIcon,
  '/matches': Gamepad as NavIcon,
  '/learn': BookBookmark as NavIcon,
  '/tournaments': Cup as NavIcon,
  '/feed': UsersGroupRounded as NavIcon,
}

export const navItems: NavItem[] = parseNavigationContract(navigation).map((destination) => ({
  icon: iconsByHref[destination.href],
  label: destination.label,
  href: destination.href,
  wip: destination.status === 'soon',
}))
