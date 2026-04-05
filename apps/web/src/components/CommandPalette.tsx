'use client'

import { trpc } from '@/lib/trpc'
import { fixEncoding } from '@/lib/utils'
import { navItems } from '@/components/sidebar/nav-items'
import { Avatar, AvatarFallback, AvatarImage } from '@brawltome/ui'
import { Search, Shield } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounce } from 'use-debounce'

type Command =
  | { kind: 'nav'; id: string; label: string; href: string; icon: React.ReactNode }
  | {
      kind: 'player'
      id: string
      label: string
      region: string | null
      rating: number
      bestLegendNameKey?: string | null
      href: string
    }
  | { kind: 'clan'; id: string; label: string; href: string }

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery] = useDebounce(query, 300)
  const [playerResults, setPlayerResults] = useState<
    Array<{
      brawlhallaId: number
      name: string
      region: string | null
      rating: number
      bestLegendNameKey?: string | null
    }>
  >([])
  const [clanResults, setClanResults] = useState<Array<{ clanId: number; clanName: string }>>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Build the flat command list the palette is currently showing.
  const commands = useMemo<Command[]>(() => {
    if (query.trim().length < 2) {
      return navItems.map((item) => {
        const Icon = item.icon
        return {
          kind: 'nav' as const,
          id: `nav-${item.href}`,
          label: item.label,
          href: item.href,
          icon: <Icon className="h-4 w-4" weight={item.iconWeight ?? 'Linear'} />,
        }
      })
    }
    const players: Command[] = playerResults.map((p) => ({
      kind: 'player' as const,
      id: `p-${p.brawlhallaId}`,
      label: fixEncoding(p.name),
      region: p.region,
      rating: p.rating,
      bestLegendNameKey: p.bestLegendNameKey,
      href: `/player/${p.brawlhallaId}`,
    }))
    const clans: Command[] = clanResults.map((c) => ({
      kind: 'clan' as const,
      id: `c-${c.clanId}`,
      label: fixEncoding(c.clanName),
      href: `/clan/${c.clanId}`,
    }))
    return [...players, ...clans]
  }, [query, playerResults, clanResults])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setPlayerResults([])
    setClanResults([])
    setSelectedIndex(0)
  }, [])

  const activate = useCallback(
    (cmd: Command) => {
      router.push(cmd.href)
      close()
    },
    [router, close],
  )

  // Global shortcut: Cmd+K on Mac, Ctrl+K elsewhere. Also Escape to close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape' && open) {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, close])

  // Focus the input when opened.
  useEffect(() => {
    if (open) {
      // A tick later so the input is mounted.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Reset selection when the command list changes.
  useEffect(() => {
    setSelectedIndex(0)
  }, [commands])

  // Run tRPC search when the debounced query changes.
  useEffect(() => {
    let cancelled = false
    if (debouncedQuery.trim().length < 2) {
      setPlayerResults([])
      setClanResults([])
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    trpc.search.local
      .query({ query: debouncedQuery })
      .then((data) => {
        if (cancelled) return
        setPlayerResults(data.players)
        setClanResults(data.clans)
        setIsSearching(false)
      })
      .catch(() => {
        if (cancelled) return
        setIsSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  // Scroll the selected row into view as the user arrow-keys through results.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open) return null

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, Math.max(0, commands.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = commands[selectedIndex]
      if (cmd) {
        activate(cmd)
        return
      }
      // Fallback: if the query is a numeric brawlhalla id, jump to that player.
      if (/^\d{5,}$/.test(query.trim())) {
        router.push(`/player/${query.trim()}`)
        close()
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={close}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        role="button"
        tabIndex={-1}
        aria-label="Close command palette"
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-xl mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search players, clans, or navigate..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {isSearching && (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-border text-[10px] font-mono text-muted-foreground shrink-0">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <>
              <div className="text-[10px] font-bold uppercase text-muted-foreground px-2 py-1.5 tracking-wider">
                Navigation
              </div>
              {commands.map((cmd, index) => (
                <CommandRow
                  key={cmd.id}
                  index={index}
                  selected={index === selectedIndex}
                  onSelect={() => activate(cmd)}
                  onHover={() => setSelectedIndex(index)}
                >
                  {cmd.kind === 'nav' && (
                    <>
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {cmd.icon}
                      </div>
                      <span className="text-sm font-medium text-foreground">{cmd.label}</span>
                    </>
                  )}
                </CommandRow>
              ))}
            </>
          ) : commands.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {isSearching ? 'Searching...' : 'No results found.'}
            </div>
          ) : (
            commands.map((cmd, index) => (
              <CommandRow
                key={cmd.id}
                index={index}
                selected={index === selectedIndex}
                onSelect={() => activate(cmd)}
                onHover={() => setSelectedIndex(index)}
              >
                {cmd.kind === 'player' && (
                  <>
                    <Avatar className="h-8 w-8 rounded-md border border-border bg-muted shrink-0">
                      {cmd.bestLegendNameKey && (
                        <AvatarImage
                          src={`/images/legends/avatars/${cmd.bestLegendNameKey}.png`}
                          alt={cmd.bestLegendNameKey}
                          className="object-cover object-top"
                        />
                      )}
                      <AvatarFallback className="text-[9px] uppercase font-bold text-muted-foreground rounded-md">
                        {cmd.label.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{cmd.label}</div>
                      <div className="text-[10px] text-muted-foreground">{cmd.region ?? 'Unknown'}</div>
                    </div>
                    <div className="text-xs font-mono text-primary shrink-0">{cmd.rating ?? 0}</div>
                  </>
                )}
                {cmd.kind === 'clan' && (
                  <>
                    <div className="h-8 w-8 rounded-md border border-border bg-muted flex items-center justify-center shrink-0">
                      <Shield className="h-4 w-4 text-muted-foreground fill-current" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{cmd.label}</div>
                      <div className="text-[10px] text-muted-foreground">Clan</div>
                    </div>
                  </>
                )}
              </CommandRow>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-border font-mono">
              &uarr;&darr;
            </kbd>
            <span>navigate</span>
            <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-border font-mono">
              &crarr;
            </kbd>
            <span>select</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-border font-mono">
              Ctrl
            </kbd>
            <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-border font-mono">K</kbd>
          </div>
        </div>
      </div>
    </div>
  )
}

function CommandRow({
  index,
  selected,
  onSelect,
  onHover,
  children,
}: {
  index: number
  selected: boolean
  onSelect: () => void
  onHover: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-index={index}
      onClick={onSelect}
      onMouseMove={onHover}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      }`}
    >
      {children}
    </button>
  )
}
