'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useDebounce } from 'use-debounce';
import { fetcher } from '@/lib/api';
import { fixEncoding } from '@/lib/utils';
import { Input, Card, Avatar, AvatarImage, AvatarFallback } from '@brawltome/ui';

interface SearchBarProps {
    onFocus?: () => void;
    onBlur?: () => void;
}

export function SearchBar({ onFocus, onBlur }: SearchBarProps) {
    const [query, setQuery] = useState('');
    const [debouncedQuery] = useDebounce(query, 500);
    interface SearchResult {
        brawlhallaId: number;
        name: string;
        region?: string;
        rating?: number;
        bestLegendName?: string;
    }
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);

    // Handle click outside to clear query
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
        setError(null);
        if (!debouncedQuery || debouncedQuery.length < 3) {
            setResults([]);
            return;
        }

        setIsSearching(true);
        fetcher(`/search/local?q=${debouncedQuery}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((data: any) => {
            setResults(data);
            setIsSearching(false);
            if (data.length === 0) {
                 // Check if it looks like an ID (all digits)
                 if (/^\d+$/.test(debouncedQuery)) {
                     // The backend handles ID search automatically in "local" endpoint
                     // If it returned 0 results, it means the ID wasn't found even after API lookup
                     setError('Player ID not found.');
                 } else {
                     // It's a name search, and we only search locally
                     setError('Player not found locally. Try searching by ID.');
                 }
            }
        })
        .catch((err: unknown) => {
            setIsSearching(false);
            const error = err as Error & { cause?: string };
            if (error.message?.includes('429') || error.cause === 'Too Many Requests') {
                setError('Server busy (High Traffic). Please try again later.');
            } else {
                setError('Search failed.');
            }
        });
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
                    placeholder="Search player..."
                    className="w-full h-14 bg-background/50 text-foreground text-lg rounded-xl border-border focus-visible:ring-primary backdrop-blur-sm pr-12"
                />
                
                {isSearching && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                )}
            </div>
    
            <div className={`transition-all duration-300 ease-in-out ${(query.length >= 3 && (results.length > 0 || error)) ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
                {(results.length > 0 || error) && (
                <Card className="absolute w-full mt-2 bg-card border-border overflow-hidden shadow-2xl z-50">
                    {error ? (
                        <div className="p-4 text-center text-muted-foreground text-sm">
                            {error}
                        </div>
                    ) : (
                        <>
                        {results.map((p) => (
                        <button
                            key={p.brawlhallaId}
                            onClick={() => router.push(`/player/${p.brawlhallaId}`)}
                            className="w-full text-left p-3 hover:bg-accent hover:text-accent-foreground border-b border-border last:border-0 flex justify-between items-center group transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                {p.bestLegendName && (
                                    <Avatar className="h-8 w-8 border border-border bg-muted">
                                        <AvatarImage 
                                            src={`/images/legends/${p.bestLegendName}.png`} 
                                            alt={p.bestLegendName} 
                                            className="object-cover"
                                        />
                                        <AvatarFallback className="text-[10px] uppercase font-bold text-muted-foreground">
                                            {p.bestLegendName.substring(0, 2)}
                                        </AvatarFallback>
                                    </Avatar>
                                )}
                                <div>
                                    <div className="font-bold text-card-foreground">{fixEncoding(p.name)}</div>
                                    <div className="text-xs text-muted-foreground">{p.region}</div>
                                </div>
                            </div>
                            <div className="text-sm font-mono text-primary">{p.rating || '---'}</div>
                        </button>
                        ))}
                        </>
                    )}
                </Card>
                )}
            </div>
        </div>
    );
}
