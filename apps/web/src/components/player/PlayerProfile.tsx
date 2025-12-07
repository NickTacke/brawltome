'use client';

import { useState, useRef } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetcher } from '@/lib/api';
import { fixEncoding, timeAgo } from '@/lib/utils';
import { 
    Card, 
    CardContent, 
    CardHeader, 
    CardTitle,
    Badge,
    Progress,
    Avatar,
    AvatarFallback,
    AvatarImage,
    Button
} from '@brawltome/ui';
import { ChevronDown, ChevronUp, Clock } from 'lucide-react';

interface PlayerProfileProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialData: any;
    id: string;
}

const RANK_BANNERS: Record<string, string> = {
    'Diamond': '/images/banners/Diamond.png',
    'Platinum': '/images/banners/Platinum.png',
    'Gold': '/images/banners/Gold.png',
    'Silver': '/images/banners/Silver.png',
    'Bronze': '/images/banners/Bronze.png',
    'Tin': '/images/banners/Tin.png',
    'Valhallan': '/images/banners/Valhallan.png',
};

const getRankBanner = (tier: string) => {
    const baseTier = tier.split(' ')[0];
    return RANK_BANNERS[baseTier] || '/images/banners/Unranked.png';
}

export function PlayerProfile({ initialData, id }: PlayerProfileProps) {
    const router = useRouter();
    const [showAllLegends, setShowAllLegends] = useState(false);

    // SWR with fallback data
    const { data: player } = useSWR(`/player/${id}`, fetcher, {
        fallbackData: initialData,
        refreshInterval: (data) => (data?.isRefreshing ? 2000 : 0),
    });
    const isRefreshing = player?.isRefreshing;

    const allLegends = player?.stats?.legends
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.sort((a: any, b: any) => b.xp - a.xp) || [];

    const displayedLegends = showAllLegends ? allLegends : allLegends.slice(0, 6);

    const legendsRef = useRef<HTMLDivElement>(null);

    const handleToggleLegends = () => {
        if (showAllLegends) {
            legendsRef.current?.scrollIntoView({ behavior: 'instant' });
        }
        setShowAllLegends(!showAllLegends);
    };

    const rankedTeams = player?.ranked?.teams
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.sort((a: any, b: any) => b.rating - a.rating);

    const winrate = player.games > 0 ? (player.wins / player.games) * 100 : 0;

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
                <div className="flex items-center gap-6">
                    {/* Best Legend Avatar (if available from stats) */}
                    {allLegends.length > 0 && (
                        <Avatar className="h-24 w-24 border-4 border-card rounded-2xl">
                            <AvatarImage 
                                src={`/images/legends/${allLegends[0].bioName}.png`} 
                                alt={allLegends[0].bioName} 
                                className="object-cover object-top"
                            />
                            <AvatarFallback className="bg-muted text-3xl font-bold text-muted-foreground capitalize rounded-2xl">
                                {allLegends[0].bioName?.[0] || '?'}
                            </AvatarFallback>
                        </Avatar>
                    )}
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
                        <div className="flex justify-between items-center">
                            <CardTitle className="text-xl font-bold flex items-center gap-2">
                                🏆 Ranked Performance
                            </CardTitle>
                            {player.ranked?.lastUpdated && (
                                <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5 hover:bg-muted/50 transition-colors">
                                    <Clock className="w-3 h-3" />
                                    Updated {timeAgo(player.ranked.lastUpdated)}
                                </Badge>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="relative z-10">
                        <div className="flex flex-col gap-8">
                            <div className="flex justify-between items-start">
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
                                <div className="text-right">
                                    <div className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-1">Peak Rating</div>
                                    <div className="text-4xl font-black text-foreground">{player.peakRating}</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-y-6 gap-x-8 pt-6 border-t border-border">
                                <div className="col-span-2">
                                    <div className="flex justify-between items-end mb-2">
                                        <div className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Win Rate</div>
                                        <div className={`text-2xl font-black ${winrate >= 50 ? 'text-green-500' : 'text-foreground'}`}>
                                            {winrate.toFixed(1)}%
                                        </div>
                                    </div>
                                    <Progress value={winrate} className="h-4" />
                                    <div className="flex justify-between text-xs text-muted-foreground mt-2 font-mono">
                                        <span>{player.wins} Wins</span>
                                        <span>{player.games - player.wins} Losses</span>
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
                        <div className="flex justify-between items-center">
                            <CardTitle className="text-xl font-bold text-chart-3 flex items-center gap-2">
                                📊 Combat Record
                            </CardTitle>
                            {player.stats?.lastUpdated && (
                                <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5 hover:bg-muted/50 transition-colors">
                                    <Clock className="w-3 h-3" />
                                    Updated {timeAgo(player.stats.lastUpdated)}
                                </Badge>
                            )}
                        </div>
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
                                        <span className="text-foreground font-bold">{player.stats.games > 0 ? ((player.stats.wins / player.stats.games) * 100).toFixed(1) : 0}%</span>
                                    </div>
                                    <Progress value={player.stats.games > 0 ? (player.stats.wins / player.stats.games) * 100 : 0} className="h-3" />
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

            {/* Legends */}
            {allLegends.length > 0 && (
                <div id="legends-section" ref={legendsRef} className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold text-foreground">Legend Statistics</h2>
                        <span className="text-sm text-muted-foreground font-mono">{allLegends.length} Legends Played</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {displayedLegends.map((legend: any) => (
                            <Card key={legend.legendId} className="hover:bg-accent hover:text-accent-foreground transition-colors cursor-default">
                                <CardContent className="p-4 flex items-center gap-4">
                                    <Avatar className="w-12 h-12 rounded-md">
                                        <AvatarImage 
                                            src={`/images/legends/${legend.bioName}.png`} 
                                            alt={legend.bioName} 
                                            className="object-cover object-top"
                                            loading="lazy"
                                        />
                                        <AvatarFallback className="bg-muted text-xl font-bold text-muted-foreground capitalize rounded-md">
                                            {legend.bioName?.[0] || '?'}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start">
                                            <h3 className="font-bold capitalize truncate">{legend.bioName || legend.legendNameKey}</h3>
                                            <Badge variant="secondary" className="text-xs font-mono">Lvl {legend.level}</Badge>
                                        </div>
                                        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                                            <span>{legend.xp.toLocaleString()} XP</span>
                                            <span className={legend.games > 0 && legend.wins / legend.games > 0.5 ? "text-green-500" : "text-muted-foreground"}>
                                                {legend.games > 0 ? ((legend.wins / legend.games) * 100).toFixed(0) : 0}% WR
                                            </span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                    
                    {allLegends.length > 6 && (
                        <div className="flex justify-center mt-6">
                            <Button 
                                variant="outline" 
                                onClick={handleToggleLegends}
                                className="gap-2"
                            >
                                {showAllLegends ? (
                                    <>Show Less <ChevronUp className="h-4 w-4" /></>
                                ) : (
                                    <>Show All Legends <ChevronDown className="h-4 w-4" /></>
                                )}
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* Teams */}
            {rankedTeams && rankedTeams.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">2v2 Teammates</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {rankedTeams.map((team: any, i: number) => {
                            const teammateId = team.brawlhallaIdOne === parseInt(id) ? team.brawlhallaIdTwo : team.brawlhallaIdOne;
                            const bannerUrl = getRankBanner(team.tier);
                            
                            const teamNameParts = fixEncoding(team.teamName).split('+');
                            const teammateNameIndex = team.brawlhallaIdOne === parseInt(id) ? 1 : 0;
                            const teammateName = teamNameParts[teammateNameIndex]?.trim() || teamNameParts.find(part => part.trim() !== fixEncoding(player.name))?.trim() || fixEncoding(team.teamName);

                            return (
                            <div 
                                key={i} 
                                onClick={() => router.push(`/player/${teammateId}`)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        router.push(`/player/${teammateId}`);
                                    }
                                }}
                                role="button"
                                tabIndex={0}
                                className="group flex items-stretch rounded-xl bg-card border border-border hover:border-primary transition-colors cursor-pointer h-36 relative overflow-visible mt-4"
                            >
                                {/* Rank Banner on Left - Bleeding Out */}
                                <div className="absolute -top-0.5 left-4 w-24 h-[120%] z-20 pointer-events-none filter drop-shadow-xl">
                                    <div 
                                        className="w-full h-full bg-top bg-no-repeat bg-contain transition-transform duration-300"
                                        style={{ backgroundImage: `url(${bannerUrl})` }}
                                    />
                                </div>
                                
                                {/* Content Spacer for Banner */}
                                <div className="w-32 flex-shrink-0" />
                                
                                {/* Content */}
                                <div className="flex-1 p-4 flex flex-col justify-between">
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="min-w-0 flex-1">
                                            <h3 className="font-bold text-foreground text-lg leading-tight group-hover:text-primary transition-colors truncate">
                                                {teammateName}
                                            </h3>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-xs font-mono text-muted-foreground">Teammate ID: {teammateId}</span>
                                            </div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className="text-2xl font-black text-chart-3 leading-none">
                                                {team.rating}
                                                <span className="text-sm font-medium text-muted-foreground ml-1.5 align-baseline opacity-80">
                                                    / {team.peakRating}
                                                </span>
                                            </div>
                                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-1">{team.tier}</div>
                                        </div>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-4 mt-2">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Wins / Games</span>
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-foreground font-mono font-bold">{team.wins}</span>
                                                <span className="text-xs text-muted-foreground">/ {team.games}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col text-right">
                                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Win Rate</span>
                                            <span className={`font-mono font-bold ${team.games > 0 && (team.wins / team.games) > 0.5 ? 'text-green-500' : 'text-foreground'}`}>
                                                {team.games > 0 ? ((team.wins / team.games) * 100).toFixed(1) : 0}%
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )})}
                    </div>
                </div>
            )}
        </div>
    );
}
