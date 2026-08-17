'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui'
import type { WeaponSortKey } from './utils'

const WEAPON_SORT_OPTIONS: { value: WeaponSortKey; label: string }[] = [
  { value: 'timePlayed', label: 'Time Played' },
  { value: 'games', label: 'Games' },
  { value: 'winrate', label: 'Win Rate' },
  { value: 'damage', label: 'Damage' },
  { value: 'kos', label: 'KOs' },
]

interface SortControlsProps {
  sortBy: WeaponSortKey
  onChange: (key: WeaponSortKey) => void
  weaponCount: number
}

export function SortControls({ sortBy, onChange, weaponCount }: SortControlsProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground font-mono">Weapons: {weaponCount}</span>
      <Select value={sortBy} onValueChange={(v) => onChange(v as WeaponSortKey)}>
        <SelectTrigger className="w-[130px] font-bold h-9 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WEAPON_SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="cursor-pointer text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
