'use client'

import { Search } from 'lucide-react'
import type React from 'react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  isSearching: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
}

export function SearchInput({ value, onChange, onKeyDown, isSearching, inputRef }: SearchInputProps) {
  return (
    <div className="flex items-center gap-3 px-5 border-b border-border">
      <Search className="h-5 w-5 text-muted-foreground shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search players, clans, or navigate..."
        aria-label="Command palette search"
        className="flex-1 h-14 bg-transparent text-base text-foreground placeholder:text-muted-foreground outline-none"
      />
      {isSearching && (
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
      )}
      <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-border text-[10px] font-mono text-muted-foreground shrink-0">
        ESC
      </kbd>
    </div>
  )
}
