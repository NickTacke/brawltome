'use client'

import { trpc } from '@/lib/trpc'
import { fixEncoding } from '@/lib/utils'
import { navItems } from '@/components/sidebar/nav-items'
import { Avatar, AvatarFallback, AvatarImage, Card } from '@brawltome/ui'
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
  const [debouncedQuery] = useDebounce(query, 200)
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

  const isSearchMode = query.trim().length >= 2

  // Build the flat command list the palette is currently showing. The branch
  // uses the live query so the list swaps instantly when the user starts/stops
  // typing, but the actual search results come from debounced state, so old
  // results stay visible while new ones are fetched (no flash of "no results").
  const commands = useMemo<Command[]>(() => {
    if (!isSearchMode) {
      return navItems.map((item) => {
        const Icon = item.icon
        return {
          kind: 'nav' as const,
          id: `nav-${item.href}`,
          label: item.label,
          href: item.href,
          icon: <Icon className="h-5 w-5" weight={item.iconWeight ?? 'Linear'} />,
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
  }, [isSearchMode, playerResults, clanResults])

  const close = useCallback(() => {
    setOpen(false)
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

  // Focus input on open and reset state a tick after close so the exit animation
  // can play before the list clears.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    const t = setTimeout(() => {
      setQuery('')
      setPlayerResults([])
      setClanResults([])
      setSelectedIndex(0)
    }, 200)
    return () => clearTimeout(t)
  }, [open])

  // Reset selection when the command list changes.
  useEffect(() => {
    setSelectedIndex(0)
  }, [commands])

  // Run tRPC search only when open and query is long enough.
  useEffect(() => {
    if (!open) return
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
  }, [open, debouncedQuery])

  // Scroll the selected row into view as the user arrow-keys through results.
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    if (!list) return
    const el = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, open])

  // Lock body scroll while the palette is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

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
      if (/^\d{5,}$/.test(query.trim())) {
        router.push(`/player/${query.trim()}`)
        close()
      }
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] transition-opacity duration-200 ${
        open ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={close}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        role="button"
        tabIndex={-1}
        aria-label="Close command palette"
      />

      {/* Panel */}
      <Card
        className={`relative w-full max-w-xl mx-4 bg-card border-border shadow-2xl overflow-hidden transition-[opacity,transform] duration-200 ease-out ${
          open ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-3 scale-[0.98] opacity-0'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Input row - matches SearchBar sizing for consistency */}
        <div className="flex items-center gap-3 px-5 border-b border-border">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search players, clans, or navigate..."
            className="flex-1 h-14 bg-transparent text-base text-foreground placeholder:text-muted-foreground outline-none"
          />
          {isSearching && (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-border text-[10px] font-mono text-muted-foreground shrink-0">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent"
        >
          {query.trim().length < 2 ? (
            <>
              <div className="text-[10px] font-bold uppercase text-muted-foreground px-4 pt-3 pb-1 tracking-wider">
                Navigation
              </div>
              {commands.map((cmd, index) => (
                <CommandRow
                  key={cmd.id}
                  index={index}
                  selected={index === selectedIndex}
                  onSelect={() => activate(cmd)}
                  onHover={() => setSelectedIndex(index)}
                  isLast={index === commands.length - 1}
                >
                  {cmd.kind === 'nav' && (
                    <>
                      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground shrink-0">
                        {cmd.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-card-foreground">{cmd.label}</div>
                        <div className="text-xs text-muted-foreground">Go to {cmd.href}</div>
                      </div>
                    </>
                  )}
                </CommandRow>
              ))}
            </>
          ) : commands.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {isSearching || debouncedQuery.trim().length < 2 ? 'Searching...' : 'No results found.'}
            </div>
          ) : (
            commands.map((cmd, index) => (
              <CommandRow
                key={cmd.id}
                index={index}
                selected={index === selectedIndex}
                onSelect={() => activate(cmd)}
                onHover={() => setSelectedIndex(index)}
                isLast={index === commands.length - 1}
              >
                {cmd.kind === 'player' && (
                  <>
                    <Avatar className="h-10 w-10 border border-border bg-muted rounded-md shrink-0">
                      {cmd.bestLegendNameKey && (
                        <AvatarImage
                          src={`/images/legends/avatars/${cmd.bestLegendNameKey}.png`}
                          alt={cmd.bestLegendNameKey}
                          className="object-cover object-top"
                        />
                      )}
                      <AvatarFallback className="text-[10px] uppercase font-bold text-muted-foreground rounded-md">
                        {cmd.label.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-card-foreground truncate">{cmd.label}</div>
                      <div className="text-xs text-muted-foreground">{cmd.region ?? 'Unknown'}</div>
                    </div>
                    <div className="text-sm font-mono text-primary shrink-0">{cmd.rating ?? 0}</div>
                  </>
                )}
                {cmd.kind === 'clan' && (
                  <>
                    <div className="h-10 w-10 rounded-full border border-border bg-muted flex items-center justify-center shrink-0">
                      <Shield className="h-5 w-5 text-muted-foreground fill-current" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-card-foreground truncate">{cmd.label}</div>
                      <div className="text-xs text-muted-foreground">Clan</div>
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
      </Card>
    </div>
  )
}

function CommandRow({
  index,
  selected,
  onSelect,
  onHover,
  isLast,
  children,
}: {
  index: number
  selected: boolean
  onSelect: () => void
  onHover: () => void
  isLast: boolean
  children: React.ReactNode
}) {
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
