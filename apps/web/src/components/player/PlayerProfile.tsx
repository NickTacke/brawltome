'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';

interface PlayerProfileProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialData: any;
    id: string;
}

export function PlayerProfile({ initialData, id }: PlayerProfileProps) {
    // SWR with fallback data
    const { data: player } = useSWR(`/player/${id}`, fetcher, {
        fallbackData: initialData,
        refreshInterval: (data) => (data?.isRefreshing ? 2000 : 0),
    });
    const isRefreshing = player?.isRefreshing;

    return (
        <div className="max-w-5xl mx-auto p-6 space-y-8">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-5xl font-black text-white tracking-tight">{player.name}</h1>
              <div className="flex items-center gap-2 mt-2 text-slate-400">
                 <span>{player.region}</span>
                 <span>•</span>
                 <span>ID: {player.brawlhallaId}</span>
              </div>
            </div>
    
            {isRefreshing && (
              <div className="flex items-center gap-3 px-4 py-2 bg-blue-500/10 text-blue-400 rounded-full border border-blue-500/20 animate-pulse">
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium">Syncing live data...</span>
              </div>
            )}
          </div>
    
          {/* Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Card: Ranked */}
            <div className="p-8 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 relative overflow-hidden">
                <div className="relative z-10">
                    <h2 className="text-xl font-bold text-yellow-500 mb-4 flex items-center gap-2">
                        🏆 Ranked Performance
                    </h2>
                    
                    
                    <div className="space-y-4">
                        <div className="flex items-baseline gap-2">
                            <span className="text-6xl font-black text-white">{player.rating}</span>
                            <span className="text-xl text-slate-400">ELO</span>
                        </div>
                        <div className="inline-block px-3 py-1 rounded bg-yellow-500/20 text-yellow-300 font-bold">
                            {player.tier}
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-700/50">
                            <div>
                                <div className="text-slate-500 text-sm">Peak Rating</div>
                                <div className="text-white font-mono">{player.peakRating}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
    
            {/* Card: Stats */}
            <div className="p-8 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700">
                 <h2 className="text-xl font-bold text-purple-400 mb-4">📊 Combat Record</h2>
                 
                 {player.stats ? (
                     <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <span className="text-slate-400">Account Level</span>
                            <span className="text-2xl font-bold text-white">{player.stats.level}</span>
                        </div>
                        
                        <div className="flex items-center justify-between">
                             <span className="text-slate-400">Total Games</span>
                             <span className="text-2xl font-bold text-white">{player.stats.games}</span>
                        </div>
    
                        <div className="w-full bg-slate-700 rounded-full h-2">
                            <div 
                               className="bg-purple-500 h-2 rounded-full" 
                               style={{ width: `${(player.stats.wins / player.stats.games) * 100}%`}}
                            />
                        </div>
                        <div className="text-right text-xs text-purple-300">
                            {((player.stats.wins / player.stats.games) * 100).toFixed(1)}% Win Rate
                        </div>
                     </div>
                 ) : (
                    <div className="h-40 flex items-center justify-center text-slate-500 italic">
                        Fetching extended stats...
                    </div>
                 )}
            </div>
    
          </div>
        </div>
    );
}