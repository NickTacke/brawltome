'use client'

import { TableHead } from '@brawltome/ui'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SortField, SortOrder } from './utils'

interface SortableHeaderProps {
  label: string
  sortKey: SortField
  currentSort: SortField
  currentOrder: SortOrder
  onSort: (key: SortField) => void
  className?: string
}

export function SortableHeader({ label, sortKey, currentSort, currentOrder, onSort, className }: SortableHeaderProps) {
  const isActive = currentSort === sortKey
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-2 w-full hover:text-primary transition-colors font-bold"
      >
        {label}
        {isActive ? (
          currentOrder === 'asc' ? (
            <ArrowUp className="h-4 w-4" />
          ) : (
            <ArrowDown className="h-4 w-4" />
          )
        ) : (
          <ArrowUpDown className="h-4 w-4 opacity-30" />
        )}
      </button>
    </TableHead>
  )
}
