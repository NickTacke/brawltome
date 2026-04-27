'use client'

import { Button, Input } from '@brawltome/ui'
import { MAX_PAGE } from './utils'

interface PaginationControlsProps {
  page: number
  isLoading: boolean
  onPageChange: (page: number) => void
  compact?: boolean
}

export function PaginationControls({ page, isLoading, onPageChange, compact = false }: PaginationControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={page === 1 || isLoading}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        {compact ? '←' : '← Prev'}
      </Button>
      <div className="flex items-center gap-2">
        {!compact && <span className="text-sm text-muted-foreground font-mono">Page</span>}
        <Input
          key={page}
          defaultValue={page}
          className="h-8 w-16 text-center font-mono"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = Number.parseInt(e.currentTarget.value.trim(), 10)
              if (!Number.isNaN(val) && val >= 1 && val <= MAX_PAGE) onPageChange(val)
              else {
                onPageChange(1)
                e.currentTarget.value = '1'
              }
            }
          }}
        />
        <span className="text-sm text-muted-foreground font-mono">{compact ? `/${MAX_PAGE}` : `of ${MAX_PAGE}`}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= MAX_PAGE || isLoading}
        onClick={() => onPageChange(page + 1)}
      >
        {compact ? '→' : 'Next →'}
      </Button>
    </div>
  )
}
