'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { fetcher } from '@/lib/api';
import { fixEncoding } from '@/lib/utils';
import { 
    Card, 
    CardContent, 
    CardHeader, 
    CardTitle,
    Badge,
    Progress,
    Avatar,
    AvatarFallback
} from '@brawltome/ui';

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
                    className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
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
                    <h1 className="text-5xl font-black text-foreground tracking-tight">{fixEncoding(player.name)}</h1>
                    <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
                        <div className="flex items-center gap-2">
                            <Badge variant="outline">{player.region}</Badge>
                        </div>
                        <span>•</span>
                        <div>ID: <span className="font-mono text-foreground">{player.brawlhallaId}</span></div>
                        {player.stats?.clan && (
                            <>
                                <span>•</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">Clan:</span>
                                    <span className="text-primary font-bold">{fixEncoding(player.stats.clan.clanName)}</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {isRefreshing && (
                    <Badge variant="secondary" className="gap-2 animate-pulse">
                        <div className="w-2 h-2 bg-primary rounded-full animate-ping" />
                        Syncing live data...
                    </Badge>
                )}
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Card: Ranked Performance */}
                <Card className="bg-gradient-to-br from-card to-background border-border relative overflow-hidden">
                    <CardHeader>
                        <CardTitle className="text-xl font-bold text-primary flex items-center gap-2">
                            🏆 Ranked Performance
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="relative z-10">
                        <div className="flex flex-col gap-8">
                            <div>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-6xl font-black text-foreground tracking-tighter">{player.rating}</span>
                                    <span className="text-xl font-medium text-muted-foreground">ELO</span>
                                </div>
                                <div className="mt-2">
                                    <Badge variant="secondary" className="uppercase tracking-wider">
                                        {player.tier}
                                    </Badge>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-y-6 gap-x-8 pt-6 border-t border-border">
                                <div>
                                    <div className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Peak Rating</div>
                                    <div className="text-2xl text-foreground font-bold mt-1">{player.peakRating}</div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Win Rate</div>
                                    <div className="text-2xl text-foreground font-bold mt-1">
                                        {((player.wins / player.games) * 100).toFixed(1)}%
                                        <span className="text-sm text-muted-foreground font-normal ml-2">({player.wins}W - {player.games - player.wins}L)</span>
                                    </div>
                                </div>
                                {player.ranked?.regionRank > 0 && (
                                    <div>
                                        <div className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Region Rank</div>
                                        <div className="text-2xl text-foreground font-bold mt-1">#{player.ranked.regionRank}</div>
                                    </div>
                                )}
                                {player.ranked?.globalRank > 0 && (
                                    <div>
                                        <div className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Global Rank</div>
                                        <div className="text-2xl text-foreground font-bold mt-1">#{player.ranked.globalRank}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Card: Combat Record */}
                <Card className="bg-gradient-to-br from-card to-background border-border">
                    <CardHeader>
                        <CardTitle className="text-xl font-bold text-chart-3 flex items-center gap-2">
                            📊 Combat Record
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {player.stats ? (
                            <div className="space-y-8">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <div className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Account Level</div>
                                        <div className="text-3xl font-black text-foreground mt-1">{player.stats.level}</div>
                                        <div className="text-xs text-muted-foreground mt-1">{player.stats.xpPercentage ? Math.floor(player.stats.xpPercentage * 100) : 0}% to next level</div>
                                    </div>
                                    <div>
                                        <div className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Total Games</div>
                                        <div className="text-3xl font-black text-foreground mt-1">{player.stats.games.toLocaleString()}</div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Overall Win Rate</span>
                                        <span className="text-foreground font-bold">{((player.stats.wins / player.stats.games) * 100).toFixed(1)}%</span>
                                    </div>
                                    <Progress value={(player.stats.wins / player.stats.games) * 100} className="h-3" />
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>{player.stats.wins.toLocaleString()} Wins</span>
                                        <span>{(player.stats.games - player.stats.wins).toLocaleString()} Losses</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 pt-6 border-t border-border">
                                    <div>
                                        <div className="text-lg font-bold text-foreground">
                                            {player.stats.xp.toLocaleString()} <span className="text-xs text-muted-foreground font-normal">XP</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-40 flex items-center justify-center text-muted-foreground italic">
                                Fetching extended stats...
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Top Legends */}
            {topLegends && topLegends.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">Top Legends (by XP)</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {topLegends.map((legend: any) => (
                            <Card key={legend.legendId} className="hover:bg-accent hover:text-accent-foreground transition-colors cursor-default">
                                <CardContent className="p-4 flex items-center gap-4">
                                    <Avatar className="w-12 h-12">
                                        <AvatarFallback className="bg-muted text-xl font-bold text-muted-foreground capitalize">
                                            {legend.legendNameKey[0]}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start">
                                            <h3 className="font-bold capitalize truncate">{legend.legendNameKey}</h3>
                                            <Badge variant="secondary" className="text-xs font-mono">Lvl {legend.level}</Badge>
                                        </div>
                                        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                                            <span>{legend.xp.toLocaleString()} XP</span>
                                            <span className={legend.wins / legend.games > 0.5 ? "text-green-500" : "text-muted-foreground"}>
                                                {((legend.wins / legend.games) * 100).toFixed(0)}% WR
                                            </span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* Teams */}
            {rankedTeams && rankedTeams.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">2v2 Teams</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {rankedTeams.map((team: any, i: number) => (
                            <Card key={i}>
                                <CardContent className="p-6">
                                    <div className="flex justify-between items-start mb-4">
                                        <h3 className="font-bold text-foreground truncate max-w-[70%]">{fixEncoding(team.teamName)}</h3>
                                        <div className="text-right">
                                            <div className="text-primary font-bold">{team.rating}</div>
                                            <div className="text-xs text-muted-foreground">{team.tier}</div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div className="bg-muted/50 rounded p-2 text-center">
                                            <div className="text-muted-foreground text-xs uppercase">Wins</div>
                                            <div className="text-foreground font-mono">{team.wins}</div>
                                        </div>
                                        <div className="bg-muted/50 rounded p-2 text-center">
                                            <div className="text-muted-foreground text-xs uppercase">Games</div>
                                            <div className="text-foreground font-mono">{team.games}</div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
