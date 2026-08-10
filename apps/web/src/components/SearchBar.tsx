'use client'

import { trpc } from '@/lib/trpc'
import { fixEncoding, formatNum } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage, Card, Input } from '@brawltome/ui'
import { Shield } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDebounce } from 'use-debounce'

interface SearchBarProps {
  onFocus?: () => void
  onBlur?: () => void
}

export function SearchBar({ onFocus, onBlur }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery] = useDebounce(query, 500)
  const [playerResults, setPlayerResults] = useState<
    Array<{
      brawlhallaId: number
      name: string
      region: string | null
      rating: number
      bestLegendNameKey?: string | null
      matchedAlias?: string | null
    }>
  >([])
  const [clanResults, setClanResults] = useState<
    Array<{
      clanId: number
      clanName: string
      clanXp: string
    }>
  >([])
  const [showClans, setShowClans] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visiblePlayerCount, setVisiblePlayerCount] = useState(5)
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)

  const handleResultNavigate = useCallback(() => {
    if (onBlur) onBlur()
    setQuery('')
    setError(null)
  }, [onBlur])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setQuery('')
        setError(null)
        if (onBlur) onBlur()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onBlur])

  useEffect(() => {
    let cancelled = false
    setError(null)
    setVisiblePlayerCount(5)

    if (!debouncedQuery || debouncedQuery.length < 2) {
      setIsSearching(false)
      setPlayerResults([])
      setClanResults([])
      return
    }

    setIsSearching(true)
    trpc.search.local
      .query({ query: debouncedQuery })
      .then((data) => {
        if (cancelled) return
        setPlayerResults(data.players)
        setClanResults(data.clans)
        setShowClans(false)
        setIsSearching(false)
        if (data.players.length === 0 && data.clans.length === 0) {
          setError('No results found.')
        }
      })
      .catch(() => {
        if (cancelled) return
        setIsSearching(false)
        setError('Search failed.')
      })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const isIdLike = /^\d{5,}$/.test(query)
      if (isIdLike) {
        router.push(`/player/${query}`)
        if (onBlur) onBlur()
        setQuery('')
      }
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-lg mx-auto z-50">
      <div className="relative">
        <Input
          type="text"
          value={query}
          onFocus={onFocus}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            setQuery(e.target.value)
            setError(null)
          }}
          placeholder="Search player or clan..."
          className="w-full h-14 bg-background/50 text-foreground text-lg rounded-xl border-border focus-visible:ring-primary backdrop-blur-xs pr-12"
        />
        {isSearching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <div
        className={`transition-all duration-300 ease-in-out ${
          query.length >= 2 && (playerResults.length > 0 || clanResults.length > 0 || error)
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}
      >
        {(playerResults.length > 0 || clanResults.length > 0 || error) && (
          <Card className="absolute w-full mt-2 bg-card border-border overflow-hidden shadow-2xl z-50">
            {error ? (
              <div className="p-4 text-center text-muted-foreground text-sm">{error}</div>
            ) : (
              <>
                {playerResults.length > 0 && (
                  <>
                    <div className="max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
                      {playerResults.slice(0, visiblePlayerCount).map((p) => (
                        <Link
                          key={`p-${p.brawlhallaId}`}
                          href={`/player/${p.brawlhallaId}`}
                          prefetch={false}
                          onClick={handleResultNavigate}
                          className="w-full text-left p-3 hover:bg-accent hover:text-accent-foreground border-b border-border last:border-0 flex justify-between items-center group transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10 border border-border bg-muted rounded-md">
                              {p.bestLegendNameKey && (
                                <AvatarImage
                                  src={`/images/legends/avatars/${p.bestLegendNameKey}.png`}
                                  alt={p.bestLegendNameKey}
                                  className="object-cover object-top"
                                />
                              )}
                              <AvatarFallback className="text-[10px] uppercase font-bold text-muted-foreground rounded-md">
                                {fixEncoding(p.name).substring(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="font-bold text-card-foreground truncate">{fixEncoding(p.name)}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {p.matchedAlias ? `Matched alias: ${fixEncoding(p.matchedAlias)}` : p.region}
                              </div>
                            </div>
                          </div>
                          <div className="text-sm font-mono text-primary">{p.rating ?? 0}</div>
                        </Link>
                      ))}
                    </div>
                    {visiblePlayerCount < playerResults.length && (
                      <button
                        type="button"
                        onClick={() => setVisiblePlayerCount((prev) => Math.min(prev + 10, playerResults.length))}
                        className="w-full p-2 bg-muted/50 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors border-t border-border flex items-center justify-center gap-2"
                      >
                        Show {Math.min(10, playerResults.length - visiblePlayerCount)} more
                      </button>
                    )}
                  </>
                )}

                {clanResults.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowClans(!showClans)}
                      className="w-full p-2 bg-muted/50 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors border-t border-border flex items-center justify-center gap-2"
                    >
                      {showClans
                        ? 'Hide Clans'
                        : `Show ${clanResults.length} Clan${clanResults.length === 1 ? '' : 's'}`}
                    </button>
                    {showClans &&
                      clanResults.map((c) => (
                        <Link
                          key={`c-${c.clanId}`}
                          href={`/clan/${c.clanId}`}
                          prefetch={false}
                          onClick={handleResultNavigate}
                          className="w-full text-left p-3 hover:bg-accent hover:text-accent-foreground border-b border-border last:border-0 flex justify-between items-center group transition-colors bg-muted/10"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full border border-border bg-muted flex items-center justify-center">
                              <Shield className="h-6 w-6 text-muted-foreground fill-current" />
                            </div>
                            <div className="font-bold text-card-foreground">{fixEncoding(c.clanName)}</div>
                          </div>
                          <div className="text-xs font-mono text-muted-foreground">{formatNum(c.clanXp)} XP</div>
                        </Link>
                      ))}
                  </>
                )}

                <div className="p-3 text-center text-xs text-muted-foreground border-t border-border bg-muted/20">
                  Not found? Press enter to search for brawlhalla id
                </div>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
