'use client'

import type { RichWeaponAgg } from '@/lib/weapon-aggregation'
import { WeaponOverallStats } from './WeaponOverallStats'
import { WeaponRankedStats } from './WeaponRankedStats'
import { computeWeaponDerived } from './utils'

interface WeaponCardExpandedProps {
  weapon: RichWeaponAgg
  isExpanded: boolean
  panelId: string
}

export function WeaponCardExpanded({ weapon, isExpanded, panelId }: WeaponCardExpandedProps) {
  const derived = computeWeaponDerived(weapon)

  return (
    <div
      id={panelId}
      className={`grid transition-all duration-300 ease-out ${
        isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
      aria-hidden={!isExpanded}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-0">
            <WeaponOverallStats weapon={weapon} derived={derived} />
            <WeaponRankedStats weapon={weapon} derived={derived} />
          </div>
        </div>
      </div>
    </div>
  )
}
