'use client'

import type { RichWeaponAgg } from '@/lib/weapon-aggregation'
import { Button, Card } from '@brawltome/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { SortControls } from './SortControls'
import { WeaponCard } from './WeaponCard'
import { type WeaponSortKey, sortWeapons } from './utils'

interface WeaponSectionProps {
  weaponStats: RichWeaponAgg[]
}

export function WeaponSection({ weaponStats }: WeaponSectionProps) {
  const [showAllWeapons, setShowAllWeapons] = useState(false)
  const [expandedWeapon, setExpandedWeapon] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<WeaponSortKey>('timePlayed')
  const weaponsRef = useRef<HTMLDivElement>(null)

  if (weaponStats.length === 0) return null

  const sortedWeapons = sortWeapons(weaponStats, sortBy)
  const displayedWeapons = showAllWeapons ? sortedWeapons : sortedWeapons.slice(0, 5)

  const handleToggleWeapons = () => {
    if (showAllWeapons) {
      weaponsRef.current?.scrollIntoView({ behavior: 'auto' })
    }
    setShowAllWeapons(!showAllWeapons)
  }

  return (
    <div ref={weaponsRef} className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-2xl font-bold text-foreground">Weapon Statistics</h2>
        <SortControls sortBy={sortBy} onChange={setSortBy} weaponCount={weaponStats.length} />
      </div>

      <Card className="overflow-hidden border-border">
        {displayedWeapons.map((w) => (
          <WeaponCard
            key={w.weapon}
            weapon={w}
            isExpanded={expandedWeapon === w.weapon}
            onToggle={() => setExpandedWeapon(expandedWeapon === w.weapon ? null : w.weapon)}
          />
        ))}
      </Card>

      {weaponStats.length > 5 && (
        <div className="flex justify-center mt-6">
          <Button variant="outline" onClick={handleToggleWeapons} className="gap-2">
            {showAllWeapons ? (
              <>
                Show Less <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                Show All Weapons <ChevronDown className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
