import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui'
import { LEGEND_SORT_OPTIONS, type LegendSortKey } from './utils'

interface SortControlsProps {
  sortKey: LegendSortKey
  onChange: (key: LegendSortKey) => void
}

export function SortControls({ sortKey, onChange }: SortControlsProps) {
  return (
    <Select value={sortKey} onValueChange={(v) => onChange(v as LegendSortKey)}>
      <SelectTrigger className="w-[130px] font-bold h-9 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEGEND_SORT_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="cursor-pointer text-xs">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
