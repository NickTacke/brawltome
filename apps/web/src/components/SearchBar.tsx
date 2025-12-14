'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useDebounce } from 'use-debounce';
import { Shield } from 'lucide-react';
import { fetcher } from '@/lib/api';
import { fixEncoding } from '@/lib/utils';
import {
  Input,
  Card,
  Avatar,
  AvatarImage,
  AvatarFallback,
} from '@brawltome/ui';

interface SearchBarProps {
  onFocus?: () => void;
  onBlur?: () => void;
}

export function SearchBar({ onFocus, onBlur }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebounce(query, 500);
  interface PlayerResult {
    brawlhallaId: number;
    name: string;
    region?: string;
    rating?: number;
    bestLegendName?: string;
    bestLegendNameKey?: string;
    matchedAlias?: string;
  }

  interface ClanResult {
    clanId: number;
    name: string;
    xp: string;
    memberCount: number;
  }

  const [playerResults, setPlayerResults] = useState<PlayerResult[]>([]);
  const [clanResults, setClanResults] = useState<ClanResult[]>([]);
  const [showClans, setShowClans] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to clear query
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setQuery('');
        setError(null);
        // We don't clear results here to allow the fade-out animation to play
        // The useDebounce effect will eventually clear them
        if (onBlur) onBlur();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onBlur]);

  // Local Search
  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!debouncedQuery || debouncedQuery.length < 3) {
      setIsSearching(false);
      setPlayerResults([]);
      setClanResults([]);
      return;
    }

    setIsSearching(true);
    fetcher(`/search/local?q=${encodeURIComponent(debouncedQuery)}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((data: any) => {
        if (cancelled) return;
        if (!data) {
          setPlayerResults([]);
          setClanResults([]);
          setShowClans(false);
          setIsSearching(false);
          setError('No results found.');
          return;
        }
        // Handle both old (array) and new (object) API responses
        const players = Array.isArray(data) ? data : data.players || [];
        const clans = Array.isArray(data) ? [] : data.clans || [];

        setPlayerResults(players);
        setClanResults(clans);
        setShowClans(false);
        setIsSearching(false);

        if (players.length === 0 && clans.length === 0) {
          // Check if it looks like an ID (all digits)
          if (/^\d+$/.test(debouncedQuery)) {
            // The backend handles ID search automatically in "local" endpoint
            // If it returned 0 results, it means the ID wasn't found even after API lookup
            setError('ID not found.');
          } else {
            // It's a name search, and we only search locally
            setError('No results found.');
          }
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setIsSearching(false);
        const error = err as Error & { cause?: string };
        if (error.cause === 'Too Many Requests') {
          setError('Server busy (High Traffic). Please try again later.');
        } else {
          setError('Search failed.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  return (
    <div ref={containerRef} className="relative w-full max-w-lg mx-auto z-50">
      <div className="relative">
        <Input
          type="text"
          value={query}
          onFocus={onFocus}
          // onBlur removed to prevent conflict with click-outside logic
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          placeholder="Search player or clan..."
          className="w-full h-14 bg-background/50 text-foreground text-lg rounded-xl border-border focus-visible:ring-primary backdrop-blur-sm pr-12"
        />

        {isSearching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <div
        className={`transition-all duration-300 ease-in-out ${
          query.length >= 3 &&
          (playerResults.length > 0 || clanResults.length > 0 || error)
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}
      >
        {(playerResults.length > 0 || clanResults.length > 0 || error) && (
          <Card className="absolute w-full mt-2 bg-card border-border overflow-hidden shadow-2xl z-50 max-h-[80vh] overflow-y-auto">
            {error ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {error}
              </div>
            ) : (
              <>
                {playerResults.map((p) => (
                  <button
                    type="button"
                    key={`p-${p.brawlhallaId}`}
                    onClick={() => router.push(`/player/${p.brawlhallaId}`)}
                    className="w-full text-left p-3 hover:bg-accent hover:text-accent-foreground border-b border-border last:border-0 flex justify-between items-center group transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10 border border-border bg-muted rounded-md">
                        {p.bestLegendNameKey ? (
                          <AvatarImage
                            src={`/images/legends/avatars/${p.bestLegendNameKey}.png`}
                            alt={p.bestLegendName || p.bestLegendNameKey}
                            className="object-cover object-top"
                          />
                        ) : null}
                        <AvatarFallback className="text-[10px] uppercase font-bold text-muted-foreground rounded-md">
                          {(p.bestLegendName || fixEncoding(p.name) || '?')
                            .substring(0, 2)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-bold text-card-foreground">
                          {fixEncoding(p.name)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.region}
                        </div>
                        {p.matchedAlias && (
                          <div className="text-xs text-muted-foreground">
                            Matched alias: {fixEncoding(p.matchedAlias)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-sm font-mono text-primary">
                      {p.rating || '0'}
                    </div>
                  </button>
                ))}

                {clanResults.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowClans(!showClans)}
                      className="w-full p-2 bg-muted/50 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors border-t border-border flex items-center justify-center gap-2"
                    >
                      {showClans
                        ? 'Hide Clans'
                        : `Show ${clanResults.length} Clan${
                            clanResults.length === 1 ? '' : 's'
                          }`}
                    </button>

                    {showClans &&
                      clanResults.map((c) => (
                        <button
                          type="button"
                          key={`c-${c.clanId}`}
                          onClick={() => router.push(`/clan/${c.clanId}`)}
                          className="w-full text-left p-3 hover:bg-accent hover:text-accent-foreground border-b border-border last:border-0 flex justify-between items-center group transition-colors bg-muted/10"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full border border-border bg-muted flex items-center justify-center">
                              <Shield className="h-6 w-6 text-muted-foreground fill-current" />
                            </div>
                            <div>
                              <div className="font-bold text-card-foreground">
                                {fixEncoding(c.name)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {c.memberCount} members
                              </div>
                            </div>
                          </div>
                          <div className="text-xs font-mono text-muted-foreground">
                            {c.xp ? parseInt(c.xp, 10).toLocaleString() : '0'}{' '}
                            XP
                          </div>
                        </button>
                      ))}
                  </>
                )}
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
