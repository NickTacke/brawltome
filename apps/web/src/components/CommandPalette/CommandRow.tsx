'use client'

import type React from 'react'

interface CommandRowProps {
  index: number
  selected: boolean
  onSelect: () => void
  onHover: () => void
  isLast: boolean
  children: React.ReactNode
}

export function CommandRow({ index, selected, onSelect, onHover, isLast, children }: CommandRowProps) {
  return (
    <button
      type="button"
      data-index={index}
      onClick={onSelect}
      onMouseMove={onHover}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
        isLast ? '' : 'border-b border-border'
      } ${selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}`}
    >
      {children}
    </button>
  )
}
