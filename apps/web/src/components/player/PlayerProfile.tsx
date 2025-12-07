'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { fetcher } from '@/lib/api';
import { fixEncoding } from '@/lib/utils';

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

    const topLegends = player?.stats?.legends
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.sort((a: any, b: any) => b.xp - a.xp)
        .slice(0, 6);

    const rankedTeams = player?.ranked?.teams
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.sort((a: any, b: any) => b.rating - a.rating);

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-8">
            {/* Back Button */}
            <div>
                <Link 
                    href="/"
                    className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 18-6-6 6-6"/>
                    </svg>
                    Back to Search
                </Link>
            </div>

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-5xl font-black text-white tracking-tight">{fixEncoding(player.name)}</h1>
                    <div className="flex flex-wrap items-center gap-4 mt-2 text-slate-400">
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{player.region}</span>
                        </div>
                        <span>•</span>
                        <div>ID: <span className="font-mono text-slate-300">{player.brawlhallaId}</span></div>
                        {player.stats?.clan && (
                            <>
                                <span>•</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-400">Clan:</span>
                                    <span className="text-yellow-400 font-bold">{fixEncoding(player.stats.clan.clanName)}</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {isRefreshing && (
                    <div className="flex items-center gap-3 px-4 py-2 bg-blue-500/10 text-blue-400 rounded-full border border-blue-500/20 animate-pulse">
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm font-medium">Syncing live data...</span>
                    </div>
                )}
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Card: Ranked Performance */}
                <div className="p-8 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 relative overflow-hidden">
                    <div className="relative z-10">
                        <h2 className="text-xl font-bold text-yellow-500 mb-6 flex items-center gap-2">
                            🏆 Ranked Performance
                        </h2>

                        <div className="flex flex-col gap-8">
                            <div>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-6xl font-black text-white tracking-tighter">{player.rating}</span>
                                    <span className="text-xl font-medium text-slate-400">ELO</span>
                                </div>
                                <div className="mt-2 inline-block px-3 py-1 rounded bg-yellow-500/10 text-yellow-400 font-bold text-sm border border-yellow-500/20 uppercase tracking-wider">
                                    {player.tier}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-y-6 gap-x-8 pt-6 border-t border-slate-700/50">
                                <div>
                                    <div className="text-slate-500 text-sm font-medium uppercase tracking-wide">Peak Rating</div>
                                    <div className="text-2xl text-white font-bold mt-1">{player.peakRating}</div>
                                </div>
                                <div>
                                    <div className="text-slate-500 text-sm font-medium uppercase tracking-wide">Win Rate</div>
                                    <div className="text-2xl text-white font-bold mt-1">
                                        {((player.wins / player.games) * 100).toFixed(1)}%
                                        <span className="text-sm text-slate-500 font-normal ml-2">({player.wins}W - {player.games - player.wins}L)</span>
                                    </div>
                                </div>
                                {player.ranked?.regionRank > 0 && (
                                    <div>
                                        <div className="text-slate-500 text-sm font-medium uppercase tracking-wide">Region Rank</div>
                                        <div className="text-2xl text-white font-bold mt-1">#{player.ranked.regionRank}</div>
                                    </div>
                                )}
                                {player.ranked?.globalRank > 0 && (
                                    <div>
                                        <div className="text-slate-500 text-sm font-medium uppercase tracking-wide">Global Rank</div>
                                        <div className="text-2xl text-white font-bold mt-1">#{player.ranked.globalRank}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Card: Combat Record */}
                <div className="p-8 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700">
                    <h2 className="text-xl font-bold text-purple-400 mb-6 flex items-center gap-2">
                        📊 Combat Record
                    </h2>

                    {player.stats ? (
                        <div className="space-y-8">
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <div className="text-slate-500 text-sm font-medium uppercase tracking-wide">Account Level</div>
                                    <div className="text-3xl font-black text-white mt-1">{player.stats.level}</div>
                                    <div className="text-xs text-slate-400 mt-1">{player.stats.xpPercentage ? Math.floor(player.stats.xpPercentage * 100) : 0}% to next level</div>
                                </div>
                                <div>
                                    <div className="text-slate-500 text-sm font-medium uppercase tracking-wide">Total Games</div>
                                    <div className="text-3xl font-black text-white mt-1">{player.stats.games.toLocaleString()}</div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">Overall Win Rate</span>
                                    <span className="text-white font-bold">{((player.stats.wins / player.stats.games) * 100).toFixed(1)}%</span>
                                </div>
                                <div className="w-full bg-slate-700/50 rounded-full h-3 overflow-hidden">
                                    <div
                                        className="bg-purple-500 h-full rounded-full"
                                        style={{ width: `${(player.stats.wins / player.stats.games) * 100}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-xs text-slate-500">
                                    <span>{player.stats.wins.toLocaleString()} Wins</span>
                                    <span>{(player.stats.games - player.stats.wins).toLocaleString()} Losses</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-6 border-t border-slate-700/50">
                                <div>
                                    <div className="text-lg font-bold text-white">
                                        {player.stats.xp.toLocaleString()} <span className="text-xs text-slate-500 font-normal">XP</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-40 flex items-center justify-center text-slate-500 italic">
                            Fetching extended stats...
                        </div>
                    )}
                </div>
            </div>

            {/* Top Legends */}
            {topLegends && topLegends.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold text-white">Top Legends (by XP)</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {topLegends.map((legend: any) => (
                            <div key={legend.legendId} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex items-center gap-4 hover:bg-slate-800 transition-colors">
                                <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-xl font-bold text-slate-500 capitalize">
                                    {legend.legendNameKey[0]}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start">
                                        <h3 className="font-bold text-white capitalize truncate">{legend.legendNameKey}</h3>
                                        <span className="text-xs font-mono text-slate-400">Lvl {legend.level}</span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-3 text-sm text-slate-400">
                                        <span>{legend.xp.toLocaleString()} XP</span>
                                        <span className={legend.wins / legend.games > 0.5 ? "text-green-400" : "text-slate-400"}>
                                            {((legend.wins / legend.games) * 100).toFixed(0)}% WR
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Teams */}
            {rankedTeams && rankedTeams.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold text-white">2v2 Teams</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {rankedTeams.map((team: any, i: number) => (
                            <div key={i} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <h3 className="font-bold text-white truncate max-w-[70%]">{fixEncoding(team.teamName)}</h3>
                                    <div className="text-right">
                                        <div className="text-yellow-400 font-bold">{team.rating}</div>
                                        <div className="text-xs text-slate-500">{team.tier}</div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="bg-slate-900/50 rounded p-2 text-center">
                                        <div className="text-slate-500 text-xs uppercase">Wins</div>
                                        <div className="text-white font-mono">{team.wins}</div>
                                    </div>
                                    <div className="bg-slate-900/50 rounded p-2 text-center">
                                        <div className="text-slate-500 text-xs uppercase">Games</div>
                                        <div className="text-white font-mono">{team.games}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
