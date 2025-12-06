'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDebounce } from 'use-debounce';
import { fetcher } from '@/lib/api';

export function SearchBar() {
    const [query, setQuery] = useState('');
    const [debouncedQuery] = useDebounce(query, 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [results, setResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showGlobalOption, setShowGlobalOption] = useState(false);
    const router = useRouter();

    // Local Search
    useEffect(() => {
        if (!debouncedQuery || debouncedQuery.length < 3) {
            setResults([]);
            setShowGlobalOption(false);
            return;
        }

        setIsSearching(true);
        fetcher(`/search/local?q=${debouncedQuery}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((data: any) => {
            setResults(data);
            setShowGlobalOption(data.length === 0);
            setIsSearching(false);
        })
        .catch(() => setIsSearching(false));
    }, [debouncedQuery]);

    // Vacuum Search Trigger
    const handleGlobalSearch = async () => {
        setIsSearching(true);
        try {
            const data = await fetcher(`/search/global?q=${query}`);
            setResults(data);
            setShowGlobalOption(false);
        } catch {
            console.error('Sorry, we\'re experiencing high demand right now. Please try again later.');
        } finally {
            setIsSearching(false);
        }
    }

    return (
        <div className="relative w-full max-w-lg mx-auto z-50">
            <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search player..."
                className="w-full bg-slate-800 text-white p-4 rounded-xl border border-slate-700 focus:outline-none focus:border-blue-500 transition-colors"
            />
            
            {isSearching && (
            <div className="absolute right-4 top-4">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
            )}
    
            {(results.length > 0 || showGlobalOption) && (
            <div className="absolute w-full mt-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
                {results.map((p) => (
                <button
                    key={p.brawlhallaId}
                    onClick={() => router.push(`/player/${p.brawlhallaId}`)}
                    className="w-full text-left p-3 hover:bg-slate-800 border-b border-slate-800 last:border-0 flex justify-between items-center group"
                >
                    <div>
                    <div className="font-bold text-slate-200 group-hover:text-white">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.region}</div>
                    </div>
                    <div className="text-sm font-mono text-yellow-500">{p.rating || '---'}</div>
                </button>
                ))}
    
                {showGlobalOption && !isSearching && (
                <button
                    onClick={handleGlobalSearch}
                    className="w-full p-4 bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 text-center transition-colors"
                >
                    Not found locally. <span className="font-bold underline">Search Official API?</span>
                </button>
                )}
            </div>
            )}
        </div>
    );
}