'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { fetcher } from '@/lib/api';
import { fixEncoding, timeAgo } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Progress,
} from '@brawltome/ui';
import { ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { ModeToggle } from '@/components/mode-toggle';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@brawltome/ui';
import {
  aggregateRichWeaponStats,
  LegendWeaponData,
} from '@brawltome/shared-utils';

interface PlayerProfileProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData: any;
  id: string;
}

const TIERS_WITH_SUBDIVISIONS = ['Tin', 'Bronze', 'Silver', 'Gold', 'Platinum'];

const getRankBanner = (tier?: string | null) => {
  if (!tier) return '/images/banners/Unranked.png';

  const parts = tier.split(' ');
  const baseTier = parts[0];
  const subdivision = parts[1];

  // Diamond and Valhallan have no subdivisions
  if (baseTier === 'Diamond') return '/images/banners/Diamond.png';
  if (baseTier === 'Valhallan') return '/images/banners/Valhallan.png';

  // For tiers with subdivisions, use the full tier name (encode space for CSS url())
  if (TIERS_WITH_SUBDIVISIONS.includes(baseTier) && subdivision !== undefined) {
    return `/images/banners/${baseTier}%20${subdivision}.png`;
  }

  // Fallback to base tier or unranked
  if (TIERS_WITH_SUBDIVISIONS.includes(baseTier)) {
    return `/images/banners/${baseTier}.png`;
  }

  return '/images/banners/Unranked.png';
};

const toCamelCase = (str: string): string => {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^([A-Z])/, (chr) => chr.toLowerCase());
};

const getWeaponIcon = (weapon: string) => {
  // Brawlhalla weapons mapped to image folder names
  const map: Record<string, string> = {
    Unarmed: 'Unarmed',
    Axe: 'Axe',
    Boots: 'Boots',
    Blasters: 'Blasters',
    Bow: 'Bow',
    Cannon: 'Cannon',
    Gauntlets: 'Gauntlets',
    Greatsword: 'Greatsword',
    Hammer: 'Hammer',
    Katars: 'Katars',
    Orb: 'Orb',
    'Rocket Lance': 'Lance',
    Lance: 'Lance',
    Scythe: 'Scythe',
    Spear: 'Spear',
    Sword: 'Sword',
    Pistol: 'Blasters',
    Fists: 'Gauntlets',
    Katar: 'Katars',
    RocketLance: 'Lance',
    Cannonballs: 'Cannonballs',
    Chakram: 'Chakrams',
    Gadgets: 'Gadgets',
  };
  return `/images/weapons/${map[weapon] || toCamelCase(weapon)}.png`;
}

const getWeaponDisplay = (weapon: string) => {
  const map: Record<string, string> = {
    Fists: 'Gauntlets',
    Pistol: 'Blasters',
    Katar: 'Katars',
    RocketLance: 'Lance',
    Chakram: 'Chakrams',
    ThrownItem: 'Throwables',
  };
  return map[weapon] || weapon;
}

const getGloryFromWins = (wins: number): number => {
  if (wins <= 150) return 20 * wins;
  return Math.floor(10 * (45 * Math.pow(Math.log10(wins * 2), 2)) + 245);
};

const getGloryFromBestRating = (bestRating: number): number => {
  if (bestRating < 1200) return 250;
  if (bestRating < 1286) {
    return Math.floor(10 * (25 + 0.872093023 * (86 - (1286 - bestRating))));
  }
  if (bestRating < 1390) {
    return Math.floor(10 * (100 + 0.721153846 * (104 - (1390 - bestRating))));
  }
  if (bestRating < 1680) {
    return Math.floor(10 * (187 + 0.389655172 * (290 - (1680 - bestRating))));
  }
  if (bestRating < 2000) {
    return Math.floor(10 * (300 + 0.428125 * (320 - (2000 - bestRating))));
  }
  if (bestRating < 2300) {
    return Math.floor(10 * (437 + 0.143333333 * (300 - (2300 - bestRating))));
  }
  return Math.floor(10 * (480 + 0.05 * (400 - (2700 - bestRating))));
};

const calculateGlory = (wins: number, peakRating: number): number => {
  return getGloryFromWins(wins) + getGloryFromBestRating(peakRating);
};

const calculateEloReset = (rating: number): number => {
  if (rating < 1400) return rating;
  return Math.floor(1400 + (rating - 1400) / (3 - (3000 - rating) / 800));
};

const WinLossBar = ({
  percent,
  className,
}: {
  percent: number;
  className?: string;
}) => {
  const clamped = Math.max(0, Math.min(100, percent || 0));
  return (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-red-500/30 ${
        className || ''
      }`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Win rate ${clamped.toFixed(1)}%`}
    >
      <div
        className="h-full bg-green-500 transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};

export function PlayerProfile({ initialData, id }: PlayerProfileProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [showAllLegends, setShowAllLegends] = useState(false);
  const [expandedLegendId, setExpandedLegendId] = useState<number | null>(null);
  const [showAllWeapons, setShowAllWeapons] = useState(false);
  const [expandedWeapon, setExpandedWeapon] = useState<string | null>(null);
  const [isHoveringLevel, setIsHoveringLevel] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const { data: player } = useSWR(`/player/${id}`, fetcher, {
    fallbackData: initialData,
    refreshInterval: (data) => (data?.isRefreshing ? 2000 : 0),
  });

  const weaponStats = useMemo(
    () =>
      aggregateRichWeaponStats(
        (player?.stats?.legendsEnriched || []) as LegendWeaponData[]
      ),
    [player?.stats?.legendsEnriched]
  );

  if (!player) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="text-muted-foreground">Player not found.</div>
      </div>
    );
  }

  const formatNum = (n: number | string | undefined | null) => {
    const val = typeof n === 'string' ? parseInt(n, 10) : n;
    const num = val && !isNaN(val as number) ? val : 0;
    if (!isMounted) return String(num);
    return num.toLocaleString();
  };

  const isRefreshing = player?.isRefreshing;

  const legendsSource =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (player.stats?.legendsEnriched || player.stats?.legends || []) as any[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allLegends = [...legendsSource].sort((a: any, b: any) => b.xp - a.xp);

  const displayedLegends = showAllLegends ? allLegends : allLegends.slice(0, 5);

  const legendsRef = useRef<HTMLDivElement>(null);
  const weaponsRef = useRef<HTMLDivElement>(null);

  const handleToggleLegends = () => {
    if (showAllLegends) {
      legendsRef.current?.scrollIntoView({ behavior: 'auto' });
    }
    setShowAllLegends(!showAllLegends);
  };

  const handleToggleWeapons = () => {
    if (showAllWeapons) {
      weaponsRef.current?.scrollIntoView({ behavior: 'auto' });
    }
    setShowAllWeapons(!showAllWeapons);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rankedTeamsSource = (player.ranked?.teams || []) as any[];

  const rankedTeams = [...rankedTeamsSource].sort(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a: any, b: any) => b.rating - a.rating
  );

  const winrate = player.games > 0 ? (player.wins / player.games) * 100 : 0;

  const formatHours = (totalSeconds: number) => {
    const seconds = Math.max(0, Math.floor(totalSeconds || 0));
    const hoursRaw = seconds / 3600;
    const hoursRounded = Math.round(hoursRaw * 10) / 10; // 0.1h precision
    const hoursStr = Number.isInteger(hoursRounded)
      ? String(hoursRounded)
      : hoursRounded.toFixed(1);
    return `${hoursStr}h`;
  };

  const formatCompact = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 100_000) return `${(n / 1_000).toFixed(0)}K`;
    if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
    return formatNum(n);
  };

  const parseNum = (v: unknown) => {
    const n = typeof v === 'number' ? v : parseInt(String(v ?? '0'), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const getVirtualLevel = (xp: number) => {
    // xp = 127.62 * Lv² - 2164.2 * Lv + 14553
    const a = 127.62;
    const b = -2164.2;
    const c = 14553 - xp;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return 0;
    return (-b + Math.sqrt(discriminant)) / (2 * a);
  };

  const getXpForLevel = (lv: number) => {
    return 127.62 * Math.pow(lv, 2) - 2164.2 * lv + 14553;
  };

  const playtimeSeconds =
    player?.stats?.playtimeSeconds ?? player?.stats?.matchTimeTotal ?? 0;

  const displayedWeapons = showAllWeapons
    ? weaponStats
    : weaponStats.slice(0, 5);

  const teamsTotals = rankedTeams.reduce(
    (acc, team) => {
      acc.games += parseNum(team?.games);
      acc.wins += parseNum(team?.wins);
      return acc;
    },
    { games: 0, wins: 0 }
  );
  const teamsWinrate =
    teamsTotals.games > 0 ? (teamsTotals.wins / teamsTotals.games) * 100 : 0;
  const aliases: string[] = (player?.aliases || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((a: any) => a?.value)
    .filter(
      (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
    )
    .filter((v: string) => v.trim() !== player?.name)
    .sort((a: string, b: string) => a.localeCompare(b));

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Top Navbar */}
      <div className="flex justify-between items-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to Search
        </Link>
        <ModeToggle />
      </div>

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-6 min-w-0 w-full md:w-auto md:flex-1">
          {/* Best Legend Avatar (if available from stats) */}
          {allLegends.length > 0 && (
            <Avatar className="h-20 w-20 sm:h-24 sm:w-24 border-4 border-card rounded-2xl shrink-0">
              <AvatarImage
                src={`/images/legends/avatars/${allLegends[0].legendNameKey}.png`}
                alt={allLegends[0].legendNameKey}
                className="object-cover object-top"
              />
              <AvatarFallback className="bg-muted text-xl sm:text-3xl font-bold text-muted-foreground capitalize rounded-2xl">
                {allLegends[0].legendNameKey?.[0] || '?'}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-5xl sm:h-14 font-black text-foreground tracking-tight truncate">
              {fixEncoding(player.name)}
            </h1>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{player.region}</Badge>
              </div>
              <span>•</span>
              <div>
                ID:{' '}
                <span className="font-mono text-foreground">
                  {player.brawlhallaId}
                </span>
              </div>
              {player?.stats && (
                <>
                  <span>•</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Playtime:</span>
                    <span className="font-mono text-foreground">
                      {formatHours(playtimeSeconds)}
                    </span>
                  </div>
                </>
              )}
              {aliases.length > 0 && (
                <>
                  <span>•</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        Aliases ({aliases.length})
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="max-h-[198px] overflow-y-auto pb-0 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent"
                    >
                      {aliases.map((alias: string, idx: number) => (
                        <DropdownMenuItem key={`${alias}-${idx}`}>
                          {fixEncoding(alias)}
                        </DropdownMenuItem>
                      ))}
                      {aliases.length > 5 && (
                        <div className="sticky bottom-0 h-5 bg-gradient-to-t from-popover to-transparent pointer-events-none -mt-5" />
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
              {player.stats?.clan && (
                <>
                  <span>•</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Clan:</span>
                    <Link
                      href={`/clan/${player.stats.clan.clanId}`}
                      className="text-primary font-bold hover:underline"
                    >
                      {fixEncoding(player.stats.clan.clanName)}
                    </Link>
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
        <Card className="bg-linear-to-br from-card to-background border-border">
          <CardHeader className="pb-4">
            <div className="flex justify-between items-center">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                🏆 Ranked Performance
              </CardTitle>
              {player.ranked?.lastUpdated && (
                <Badge
                  variant="outline"
                  className="text-xs font-mono text-muted-foreground gap-1.5"
                >
                  <Clock className="w-3 h-3" />
                  <span className="hidden sm:inline">Updated </span>
                  {timeAgo(player.ranked.lastUpdated)}
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-8 pt-6">
            <div className="flex gap-4 sm:gap-6">
              {/* Rank Banner */}
              <div className="w-16 sm:w-20 shrink-0">
                <img
                  src={getRankBanner(player.tier)}
                  alt={player.tier || 'Unranked'}
                  className="w-full h-auto object-contain drop-shadow-lg"
                />
              </div>

              {/* Stats */}
              <div className="flex-1 min-w-0 space-y-2">
                {/* Tier */}
                <div className="text-sm sm:text-base font-bold text-muted-foreground">
                  {player.tier || 'Unranked'}
                </div>

                {/* ELO */}
                <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap">
                  <span className="text-3xl sm:text-4xl font-black text-foreground tracking-tight leading-none">
                    {player.rating}
                  </span>
                  <span className="text-2xl sm:text-3xl font-bold text-muted-foreground/30 leading-none">
                    /
                  </span>
                  <span className="text-2xl sm:text-3xl font-bold text-muted-foreground/50 leading-none">
                    {player.peakRating}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-muted-foreground/50 uppercase tracking-wider ml-1">
                    Peak
                  </span>
                </div>

                {/* Win Rate Bar */}
                <WinLossBar percent={winrate} className="h-2.5 sm:h-3" />

                {/* Win/Loss Stats */}
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-foreground">
                    {player.wins}W{' '}
                    <span className="font-normal text-muted-foreground">
                      ({winrate.toFixed(2)}%)
                    </span>
                  </span>
                  <span className="text-foreground">
                    {player.games - player.wins}L{' '}
                    <span className="font-normal text-muted-foreground">
                      ({(100 - winrate).toFixed(2)}%)
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* Season Rewards */}
            {(() => {
              // Calculate total wins from 1v1 and all 2v2 teams
              const totalWins =
                (player.wins || 0) +
                rankedTeams.reduce(
                  (sum: number, team: { wins?: number }) =>
                    sum + (team.wins || 0),
                  0
                );

              // Find best rating across 1v1, 2v2 teams, and legends
              const ratings = [
                player.peakRating || 0,
                ...rankedTeams.map(
                  (team: { peakRating?: number }) => team.peakRating || 0
                ),
                ...allLegends.map(
                  (legend: { ranked?: { peakRating?: number } }) =>
                    legend.ranked?.peakRating || 0
                ),
              ];
              const bestRating = Math.max(...ratings, 0);

              return (
                <div className="grid grid-cols-3 gap-3 pt-5 border-t border-border/50 text-center">
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                      Ranked Games
                    </div>
                    <div className="text-lg sm:text-xl font-black text-foreground">
                      {formatNum(player.games)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                      Total Glory
                    </div>
                    <div className="text-lg sm:text-xl font-black text-foreground">
                      {formatNum(calculateGlory(totalWins, bestRating))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                      Elo Reset
                    </div>
                    <div className="text-lg sm:text-xl font-black text-foreground">
                      {calculateEloReset(player.rating)}
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Card: Combat Record */}
        <Card className="bg-linear-to-br from-card to-background border-border">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl font-bold text-chart-3 flex items-center gap-2">
                📊 Combat Record
              </CardTitle>
              {player.stats?.lastUpdated && (
                <Badge
                  variant="outline"
                  className="text-xs font-mono text-muted-foreground gap-1.5 hover:bg-muted/50 transition-colors"
                >
                  <Clock className="w-3 h-3" />
                  <span className="hidden sm:inline">Updated </span>
                  {timeAgo(player.stats.lastUpdated)}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {player.stats ? (
              <div className="space-y-8">
                <div className="grid grid-cols-2 gap-6">
                  <div
                    className="relative cursor-help"
                    onMouseEnter={() => setIsHoveringLevel(true)}
                    onMouseLeave={() => setIsHoveringLevel(false)}
                  >
                    <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wide">
                      Account Level
                    </div>
                    {player.stats.level >= 100 ? (
                      (() => {
                        const totalXp = parseNum(player.stats.xp);
                        const vLevel = getVirtualLevel(totalXp);
                        const floorLv = Math.floor(vLevel);
                        const xpAtFloor = getXpForLevel(floorLv);
                        const xpAtNext = getXpForLevel(floorLv + 1);
                        const progress =
                          xpAtNext > xpAtFloor
                            ? ((totalXp - xpAtFloor) / (xpAtNext - xpAtFloor)) *
                              100
                            : 0;

                        if (isHoveringLevel) {
                          return (
                            <div className="animate-in fade-in zoom-in-95 duration-200">
                              <div className="text-2xl sm:text-3xl font-black text-primary mt-1">
                                {floorLv}
                              </div>
                              <div className="text-xs text-primary/80 mt-1 font-medium">
                                {Math.floor(progress)}% to next level
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div className="animate-in fade-in duration-200">
                            <div className="text-2xl sm:text-3xl font-black text-foreground mt-1">
                              {player.stats.level}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 underline decoration-dotted decoration-muted-foreground/50">
                              Max level reached
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <>
                        <div className="text-2xl sm:text-3xl font-black text-foreground mt-1">
                          {player.stats.level}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {player.stats.xpPercentage
                            ? Math.floor(player.stats.xpPercentage * 100)
                            : 0}
                          % to next level
                        </div>
                      </>
                    )}
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wide">
                      Total Games
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-foreground mt-1">
                      {formatNum(player.stats.games)}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Overall Win Rate
                    </span>
                    <span className="text-foreground font-bold">
                      {player.stats.games > 0
                        ? (
                            (player.stats.wins / player.stats.games) *
                            100
                          ).toFixed(1)
                        : 0}
                      %
                    </span>
                  </div>
                  <WinLossBar
                    percent={
                      player.stats.games > 0
                        ? (player.stats.wins / player.stats.games) * 100
                        : 0
                    }
                    className="h-3"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatNum(player.stats.wins)} Wins</span>
                    <span>
                      {formatNum(player.stats.games - player.stats.wins)} Losses
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-6">
                  <div>
                    <div className="text-lg font-bold text-foreground">
                      {formatNum(player.stats.xp)}{' '}
                      <span className="text-xs text-muted-foreground font-normal">
                        XP
                      </span>
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

      {/* Weapons */}
      {weaponStats.length > 0 && (
        <div ref={weaponsRef} className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-foreground">
              Weapon Statistics
            </h2>
            <span className="text-sm text-muted-foreground font-mono">
              Total Weapons: {weaponStats.length}
            </span>
          </div>

          <Card className="overflow-hidden border-border">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {displayedWeapons.map((w: any) => {
              const isExpanded = expandedWeapon === w.weapon;
              const winrate = w.games > 0 ? (w.wins / w.games) * 100 : 0;
              const dps = w.timeHeld > 0 ? parseNum(w.damage) / w.timeHeld : 0;
              const avgKos = w.games > 0 ? w.KOs / w.games : 0;

              const avgElo =
                w.ranked.ratings.length > 0
                  ? w.ranked.ratings.reduce(
                      (a: number, b: number) => a + b,
                      0
                    ) / w.ranked.ratings.length
                  : 0;
              const avgPeak =
                w.ranked.peakRatings.length > 0
                  ? w.ranked.peakRatings.reduce(
                      (a: number, b: number) => a + b,
                      0
                    ) / w.ranked.peakRatings.length
                  : 0;

              return (
                <div
                  key={w.weapon}
                  className={`transition-all duration-200 cursor-pointer hover:bg-accent/30 ${
                    isExpanded ? 'bg-accent/20' : ''
                  }`}
                  onClick={() =>
                    setExpandedWeapon(isExpanded ? null : w.weapon)
                  }
                >
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 relative shrink-0">
                        <img
                          src={getWeaponIcon(w.weapon)}
                          alt={w.weapon}
                          className="object-contain w-full h-full"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <h3 className="font-bold text-foreground truncate text-sm">
                              {w.label || getWeaponDisplay(w.weapon)}
                            </h3>
                            <div className="mt-0.5 text-[10px] text-muted-foreground font-mono flex items-center gap-1.5">
                              <span>{formatNum(w.games)} games</span>
                              <span className="opacity-30">•</span>
                              <span
                                className={
                                  winrate >= 50
                                    ? 'text-green-500 font-bold'
                                    : ''
                                }
                              >
                                {winrate.toFixed(1)}% WR
                              </span>
                            </div>
                          </div>
                          {/* Playtime & Percentage - Prominent */}
                          <div className="flex items-baseline gap-2 shrink-0">
                            <span className="text-lg font-black text-foreground leading-none">
                              {formatHours(w.timeHeld)}
                            </span>
                            <span className="text-sm font-bold text-primary">
                              {(w.share * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                        <div className="mt-[-4px] flex items-center gap-3">
                          <Progress
                            value={w.share * 100}
                            className="h-1.5 flex-1"
                          />
                          <div className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {formatNum(w.KOs)} KOs • {formatCompact(w.damage)}{' '}
                            dmg
                          </div>
                        </div>
                      </div>
                    </div>

                    {isExpanded &&
                      (() => {
                        const rankedWinrate =
                          w.ranked.games > 0
                            ? (w.ranked.wins / w.ranked.games) * 100
                            : 0;
                        const dmgPerKO =
                          w.KOs > 0 ? Math.round(w.damage / w.KOs) : 0;
                        const avgDmgPerGame =
                          w.games > 0 ? Math.round(w.damage / w.games) : 0;
                        const avgLegendLevel =
                          w.legendCount > 0
                            ? Math.round(w.totalLevel / w.legendCount)
                            : 0;
                        const avgLegendXp =
                          w.legendCount > 0
                            ? Math.round(w.xp / w.legendCount)
                            : 0;

                        return (
                          <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                            {/* Two Column Layout */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-0">
                              {/* Left: Overall Stats */}
                              <div className="space-y-3 md:pr-4 md:border-r md:border-border/30">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                  Overall Stats
                                </div>

                                {/* Games & Winrate */}
                                <div className="space-y-1.5">
                                  <div className="flex items-baseline gap-2">
                                    <span className="text-2xl font-black text-foreground">
                                      {formatNum(w.games)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      games
                                    </span>
                                    <span className="text-muted-foreground/30 mx-1">
                                      •
                                    </span>
                                    <span className="text-sm font-mono text-muted-foreground">
                                      {formatHours(w.timeHeld)}
                                    </span>
                                  </div>
                                  <WinLossBar
                                    percent={winrate}
                                    className="h-2"
                                  />
                                  <div className="flex justify-between text-[10px] font-bold">
                                    <span className="text-foreground">
                                      {formatNum(w.wins)}W{' '}
                                      <span className="font-normal text-muted-foreground">
                                        ({winrate.toFixed(1)}%)
                                      </span>
                                    </span>
                                    <span className="text-foreground">
                                      {formatNum(w.games - w.wins)}L{' '}
                                      <span className="font-normal text-muted-foreground">
                                        ({(100 - winrate).toFixed(1)}%)
                                      </span>
                                    </span>
                                  </div>
                                </div>

                                {/* Combat Stats */}
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
                                    <div className="flex justify-between items-start mb-1">
                                      <div className="text-[9px] text-muted-foreground uppercase">
                                        KOs
                                      </div>
                                      <div className="text-[10px] font-bold text-foreground/70">
                                        {avgKos.toFixed(1)}/game
                                      </div>
                                    </div>
                                    <div className="text-lg font-black text-green-500">
                                      {formatNum(w.KOs)}
                                    </div>
                                  </div>
                                  <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
                                    <div className="flex justify-between items-start mb-1">
                                      <div className="text-[9px] text-muted-foreground uppercase">
                                        Damage
                                      </div>
                                      <div className="text-[10px] font-bold text-foreground/70">
                                        {dps.toFixed(1)} DPS
                                      </div>
                                    </div>
                                    <div className="text-lg font-black text-foreground">
                                      {formatCompact(w.damage)}
                                    </div>
                                    <div className="text-[9px] text-muted-foreground">
                                      {formatNum(avgDmgPerGame)}/game
                                    </div>
                                  </div>
                                </div>

                                {/* Stats Row 1 */}
                                <div className="grid grid-cols-4 gap-1 text-center">
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {(w.share * 100).toFixed(0)}%
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      Time %
                                    </div>
                                  </div>
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {(w.usageRate * 100).toFixed(0)}%
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      Usage
                                    </div>
                                  </div>
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {formatNum(dmgPerKO)}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      Dmg/KO
                                    </div>
                                  </div>
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {w.legendCount}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      Legends
                                    </div>
                                  </div>
                                </div>

                                {/* Stats Row 2 - Level & XP */}
                                <div className="grid grid-cols-4 gap-1 text-center">
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {formatNum(w.totalLevel)}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      Level
                                    </div>
                                  </div>
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {avgLegendLevel}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      Avg Lvl
                                    </div>
                                  </div>
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {formatCompact(w.xp)}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      XP
                                    </div>
                                  </div>
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {formatCompact(avgLegendXp)}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      Avg XP
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Right: Ranked Season */}
                              <div className="space-y-3 md:pl-4">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                                  Ranked Season
                                </div>

                                {w.ranked.games > 0 ? (
                                  <div className="space-y-3 mt-3">
                                    {/* Games & Winrate */}
                                    <div className="space-y-1.5">
                                      <div className="flex items-baseline gap-2">
                                        <span className="text-2xl font-black text-foreground">
                                          {formatNum(w.ranked.games)}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          ranked games
                                        </span>
                                      </div>
                                      <WinLossBar
                                        percent={rankedWinrate}
                                        className="h-2"
                                      />
                                      <div className="flex justify-between text-[10px] font-bold">
                                        <span className="text-foreground">
                                          {formatNum(w.ranked.wins)}W{' '}
                                          <span className="font-normal text-muted-foreground">
                                            ({rankedWinrate.toFixed(1)}%)
                                          </span>
                                        </span>
                                        <span className="text-foreground">
                                          {formatNum(
                                            w.ranked.games - w.ranked.wins
                                          )}
                                          L{' '}
                                          <span className="font-normal text-muted-foreground">
                                            ({(100 - rankedWinrate).toFixed(1)}
                                            %)
                                          </span>
                                        </span>
                                      </div>
                                    </div>

                                    {/* Elo Stats */}
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 text-center hover:bg-background/50 transition-colors">
                                        <div className="text-lg font-black text-foreground">
                                          {Math.round(avgElo)}
                                        </div>
                                        <div className="text-[8px] text-muted-foreground uppercase">
                                          Avg Elo
                                        </div>
                                      </div>
                                      <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 text-center hover:bg-background/50 transition-colors">
                                        <div className="text-lg font-black text-foreground">
                                          {Math.round(avgPeak)}
                                        </div>
                                        <div className="text-[8px] text-muted-foreground uppercase">
                                          Avg Peak
                                        </div>
                                      </div>
                                    </div>

                                    {/* Legend Stats */}
                                    <div className="space-y-1.5">
                                      {w.ranked.mostPlayed.key && (
                                        <div className="flex items-center gap-2 p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                          <Avatar className="h-6 w-6 rounded-sm">
                                            <AvatarImage
                                              src={`/images/legends/avatars/${w.ranked.mostPlayed.key}.png`}
                                            />
                                          </Avatar>
                                          <div className="flex-1 min-w-0 flex justify-between items-center">
                                            <span className="text-[10px] text-muted-foreground">
                                              Most Played
                                            </span>
                                            <span className="text-xs font-bold text-foreground">
                                              {w.ranked.mostPlayed.games} games
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                      {w.ranked.highestElo.key && (
                                        <div className="flex items-center gap-2 p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                          <Avatar className="h-6 w-6 rounded-sm">
                                            <AvatarImage
                                              src={`/images/legends/avatars/${w.ranked.highestElo.key}.png`}
                                            />
                                          </Avatar>
                                          <div className="flex-1 min-w-0 flex justify-between items-center">
                                            <span className="text-[10px] text-muted-foreground">
                                              Highest Elo
                                            </span>
                                            <span className="text-xs font-bold text-foreground">
                                              {w.ranked.highestElo.elo}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                      {w.ranked.highestPeak.key && (
                                        <div className="flex items-center gap-2 p-1.5 mb-2 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                          <Avatar className="h-6 w-6 rounded-sm">
                                            <AvatarImage
                                              src={`/images/legends/avatars/${w.ranked.highestPeak.key}.png`}
                                            />
                                          </Avatar>
                                          <div className="flex-1 min-w-0 flex justify-between items-center">
                                            <span className="text-[10px] text-muted-foreground">
                                              Highest Peak
                                            </span>
                                            <span className="text-xs font-bold text-foreground">
                                              {w.ranked.highestPeak.elo}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center justify-center py-6 text-center">
                                    <div className="text-sm text-muted-foreground">
                                      No ranked games this season
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                  </div>
                </div>
              );
            })}
          </Card>

          {weaponStats.length > 5 && (
            <div className="flex justify-center mt-6">
              <Button
                variant="outline"
                onClick={handleToggleWeapons}
                className="gap-2"
              >
                {showAllWeapons ? (
                  <>
                    Show Less <ChevronUp className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Show All Weapons <ChevronDown className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Legends */}
      {allLegends.length > 0 && (
        <div id="legends-section" ref={legendsRef} className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-foreground">
              Legend Statistics
            </h2>
            <span className="text-sm text-muted-foreground font-mono">
              Played: {allLegends.length}
            </span>
          </div>

          <Card className="overflow-hidden border-border">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {displayedLegends.map((legend: any) => {
              const isExpanded = expandedLegendId === legend.legendId;
              const wr =
                legend.games > 0 ? (legend.wins / legend.games) * 100 : 0;

              return (
                <div
                  key={legend.legendId}
                  className={`transition-all duration-200 cursor-pointer hover:bg-accent/30 ${
                    isExpanded ? 'bg-accent/20' : ''
                  }`}
                  onClick={() =>
                    setExpandedLegendId(isExpanded ? null : legend.legendId)
                  }
                >
                  <div className="p-4 space-y-3 relative overflow-hidden">
                    <div className="flex items-center gap-4 relative z-10">
                      <Avatar className="w-12 h-12 rounded-lg shadow-sm shrink-0">
                        <AvatarImage
                          src={`/images/legends/avatars/${legend.legendNameKey}.png`}
                          alt={legend.legendNameKey}
                          className="object-cover object-top"
                          loading="lazy"
                        />
                        <AvatarFallback className="bg-muted text-lg font-bold text-muted-foreground capitalize rounded-md">
                          {legend.legendNameKey?.[0] || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold capitalize truncate text-sm">
                          {legend.bioName || legend.legendNameKey}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground font-mono">
                          <span>{formatNum(legend.xp)} XP</span>
                          <span className="opacity-30">•</span>
                          <span
                            className={
                              wr > 50 ? 'text-green-500 font-bold' : ''
                            }
                          >
                            {wr.toFixed(0)}% WR
                          </span>
                          <span className="opacity-30">•</span>
                          <span>{formatHours(parseNum(legend.matchTime))}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant="secondary"
                          className="text-xs font-mono px-2 py-1 h-7"
                        >
                          Lvl {legend.level}
                        </Badge>
                        {legend.ranked && !isExpanded && (
                          <Badge
                            variant="outline"
                            className="text-xs font-mono text-muted-foreground whitespace-nowrap px-2 py-1 h-7"
                          >
                            {legend.ranked.tier} • {legend.ranked.rating}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {isExpanded &&
                      (() => {
                        const matchTime = parseNum(legend.matchTime);
                        const legendGames = parseNum(legend.games);
                        const legendWins = parseNum(legend.wins);
                        const legendKOs = parseNum(legend.KOs);
                        const legendFalls = parseNum(legend.falls);
                        const legendSuicides = parseNum(legend.suicides);
                        const legendDmgDealt = parseNum(legend.damageDealt);
                        const legendDmgTaken = parseNum(legend.damageTaken);
                        const legendWinrate =
                          legendGames > 0
                            ? (legendWins / legendGames) * 100
                            : 0;

                        // Calculated stats
                        const dpsDealt =
                          matchTime > 0 ? legendDmgDealt / matchTime : 0;
                        const avgKOsPerGame =
                          legendGames > 0 ? legendKOs / legendGames : 0;
                        const avgFallsPerGame =
                          legendGames > 0 ? legendFalls / legendGames : 0;

                        // Additional calculated stats
                        const kdRatio =
                          legendFalls > 0 ? legendKOs / legendFalls : legendKOs;
                        const dmgRatio =
                          legendDmgDealt + legendDmgTaken > 0
                            ? (legendDmgDealt /
                                (legendDmgDealt + legendDmgTaken)) *
                              100
                            : 50;

                        // Weapon stats for distribution section
                        const weaponOneTime = parseNum(
                          legend.timeHeldWeaponOne
                        );
                        const weaponTwoTime = parseNum(
                          legend.timeHeldWeaponTwo
                        );
                        const unarmedTime = Math.max(
                          0,
                          matchTime - weaponOneTime - weaponTwoTime
                        );
                        const totalWeaponTime =
                          weaponOneTime + weaponTwoTime + unarmedTime;

                        const weaponOneKOs = parseNum(legend.KOWeaponOne);
                        const weaponTwoKOs = parseNum(legend.KOWeaponTwo);
                        const unarmedKOs = parseNum(legend.KOUnarmed);
                        const totalWeaponKOs =
                          weaponOneKOs + weaponTwoKOs + unarmedKOs;

                        const weaponOneDmg = parseNum(legend.damageWeaponOne);
                        const weaponTwoDmg = parseNum(legend.damageWeaponTwo);
                        const unarmedDmg = parseNum(legend.damageUnarmed);
                        const totalWeaponDmg =
                          weaponOneDmg + weaponTwoDmg + unarmedDmg;

                        const weaponDistribution = [
                          {
                            name: legend.weaponOne,
                            kos: weaponOneKOs,
                            dmg: weaponOneDmg,
                            time: weaponOneTime,
                          },
                          {
                            name: legend.weaponTwo,
                            kos: weaponTwoKOs,
                            dmg: weaponTwoDmg,
                            time: weaponTwoTime,
                          },
                          {
                            name: 'Unarmed',
                            kos: unarmedKOs,
                            dmg: unarmedDmg,
                            time: unarmedTime,
                          },
                        ].filter(
                          (w) =>
                            w.name && (w.kos > 0 || w.dmg > 0 || w.time > 0)
                        );

                        return (
                          <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300 relative z-10 space-y-4">
                            {/* Two Column Layout with Divider */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-0">
                              {/* Left Column: Overall Stats */}
                              <div className="space-y-3 md:pr-4 md:border-r md:border-border/30">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                  Overall Stats
                                </div>

                                {/* Games & Winrate */}
                                <div className="space-y-1.5">
                                  <div className="flex items-baseline gap-2">
                                    <span className="text-2xl font-black text-foreground">
                                      {formatNum(legendGames)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      games
                                    </span>
                                    <span className="text-muted-foreground/30 mx-1">
                                      •
                                    </span>
                                    <span className="text-sm font-mono text-muted-foreground">
                                      {formatHours(matchTime)}
                                    </span>
                                  </div>
                                  <WinLossBar
                                    percent={legendWinrate}
                                    className="h-2"
                                  />
                                  <div className="flex justify-between text-[10px] font-bold">
                                    <span className="text-foreground">
                                      {formatNum(legendWins)}W{' '}
                                      <span className="font-normal text-muted-foreground">
                                        ({legendWinrate.toFixed(1)}%)
                                      </span>
                                    </span>
                                    <span className="text-foreground">
                                      {formatNum(legendGames - legendWins)}L{' '}
                                      <span className="font-normal text-muted-foreground">
                                        ({(100 - legendWinrate).toFixed(1)}%)
                                      </span>
                                    </span>
                                  </div>
                                </div>

                                {/* Combat Stats Grid */}
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
                                    <div className="flex justify-between items-start mb-1">
                                      <div className="text-[9px] text-muted-foreground uppercase">
                                        KOs / Falls
                                      </div>
                                      <div className="text-[10px] font-bold text-foreground/70">
                                        {kdRatio.toFixed(2)} K/D
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <div>
                                        <div className="text-lg font-black text-green-500">
                                          {formatNum(legendKOs)}
                                        </div>
                                        <div className="text-[8px] text-muted-foreground">
                                          KOs
                                        </div>
                                      </div>
                                      <span className="text-muted-foreground/30 text-lg">
                                        /
                                      </span>
                                      <div>
                                        <div className="text-lg font-black text-red-500/70">
                                          {formatNum(legendFalls)}
                                        </div>
                                        <div className="text-[8px] text-muted-foreground">
                                          falls
                                        </div>
                                      </div>
                                    </div>
                                    {legendSuicides > 0 && (
                                      <div className="text-[9px] text-muted-foreground mt-1">
                                        {formatNum(legendSuicides)} suicides
                                      </div>
                                    )}
                                  </div>
                                  <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
                                    <div className="flex justify-between items-start mb-1">
                                      <div className="text-[9px] text-muted-foreground uppercase">
                                        Damage
                                      </div>
                                      <div className="text-[10px] font-bold text-foreground/70">
                                        {dmgRatio.toFixed(0)}% dealt
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <div>
                                        <div className="text-lg font-black text-green-500">
                                          {formatCompact(legendDmgDealt)}
                                        </div>
                                        <div className="text-[8px] text-muted-foreground">
                                          dealt
                                        </div>
                                      </div>
                                      <span className="text-muted-foreground/30 text-lg">
                                        /
                                      </span>
                                      <div>
                                        <div className="text-lg font-black text-red-500/70">
                                          {formatCompact(legendDmgTaken)}
                                        </div>
                                        <div className="text-[8px] text-muted-foreground">
                                          taken
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Averages */}
                                <div className="grid grid-cols-4 gap-1 text-center">
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {avgKOsPerGame.toFixed(1)}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      KOs/game
                                    </div>
                                  </div>
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {avgFallsPerGame.toFixed(1)}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      Falls/game
                                    </div>
                                  </div>
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {legendKOs > 0
                                        ? formatNum(
                                            Math.round(
                                              legendDmgDealt / legendKOs
                                            )
                                          )
                                        : '—'}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      Dmg/KO
                                    </div>
                                  </div>
                                  <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                    <div className="text-sm font-black text-foreground">
                                      {dpsDealt.toFixed(1)}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">
                                      DPS
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Right Column: Ranked Season */}
                              <div className="space-y-3 md:pl-4">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                                  Ranked Season
                                </div>

                                {legend.ranked ? (
                                  (() => {
                                    const rankedWinrate =
                                      legend.ranked.games > 0
                                        ? (legend.ranked.wins /
                                            legend.ranked.games) *
                                          100
                                        : 0;
                                    return (
                                      <div className="space-y-3 mt-7">
                                        <div className="flex gap-3">
                                          {/* Rank Banner */}
                                          <div className="w-16 sm:w-18 shrink-0 mb-5">
                                            <img
                                              src={getRankBanner(
                                                legend.ranked.tier
                                              )}
                                              alt={legend.ranked.tier}
                                              className="w-full h-auto object-contain drop-shadow-lg"
                                            />
                                          </div>

                                          {/* Rating Stats */}
                                          <div className="flex-1 min-w-0 space-y-1">
                                            <div className="text-[10px] sm:text-xs font-bold text-muted-foreground">
                                              {legend.ranked.tier}
                                            </div>
                                            <div className="flex items-baseline gap-1 flex-wrap">
                                              <span className="text-2xl sm:text-3xl font-black text-foreground tracking-tight leading-none">
                                                {legend.ranked.rating}
                                              </span>
                                              <span className="text-xl sm:text-2xl font-bold text-muted-foreground/30 leading-none">
                                                /
                                              </span>
                                              <span className="text-xl sm:text-2xl font-bold text-muted-foreground/50 leading-none">
                                                {legend.ranked.peakRating}
                                              </span>
                                              <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-wider ml-0.5">
                                                Peak
                                              </span>
                                            </div>
                                            <WinLossBar
                                              percent={rankedWinrate}
                                              className="h-2"
                                            />
                                            <div className="flex justify-between text-[10px] font-bold">
                                              <span className="text-foreground">
                                                {legend.ranked.wins}W{' '}
                                                <span className="font-normal text-muted-foreground">
                                                  ({rankedWinrate.toFixed(1)}%)
                                                </span>
                                              </span>
                                              <span className="text-foreground">
                                                {legend.ranked.games -
                                                  legend.ranked.wins}
                                                L{' '}
                                                <span className="font-normal text-muted-foreground">
                                                  (
                                                  {(
                                                    100 - rankedWinrate
                                                  ).toFixed(1)}
                                                  %)
                                                </span>
                                              </span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Ranked Stats Row */}
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 text-center hover:bg-background/50 transition-colors">
                                            <div className="text-lg font-black text-foreground">
                                              {formatNum(legend.ranked.games)}
                                            </div>
                                            <div className="text-[8px] text-muted-foreground uppercase">
                                              Games
                                            </div>
                                          </div>
                                          <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 text-center hover:bg-background/50 transition-colors">
                                            <div className="text-lg font-black text-foreground">
                                              {calculateEloReset(
                                                legend.ranked.rating
                                              )}
                                            </div>
                                            <div className="text-[8px] text-muted-foreground uppercase">
                                              Elo Reset
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <div className="flex flex-col items-center justify-center py-8 text-center">
                                    <div className="w-16 sm:w-20 opacity-30 mb-3">
                                      <img
                                        src="/images/banners/Unranked.png"
                                        alt="Unranked"
                                        className="w-full h-auto object-contain"
                                      />
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                      No ranked games this season
                                    </div>
                                    <div className="text-[10px] text-muted-foreground/50 mt-1">
                                      Play ranked to see stats here
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Weapon Distribution Section */}
                            {weaponDistribution.length > 0 && (
                              <div className="pt-4 border-t border-border/30">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
                                  Weapon Distribution
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                  {weaponDistribution.map((w, idx) => {
                                    const kosPercent =
                                      totalWeaponKOs > 0
                                        ? (w.kos / totalWeaponKOs) * 100
                                        : 0;
                                    const dmgPercent =
                                      totalWeaponDmg > 0
                                        ? (w.dmg / totalWeaponDmg) * 100
                                        : 0;
                                    const timePercent =
                                      totalWeaponTime > 0
                                        ? (w.time / totalWeaponTime) * 100
                                        : 0;
                                    const weaponDps =
                                      w.time > 0 ? w.dmg / w.time : 0;
                                    const weaponTimeToKill =
                                      w.kos > 0 ? w.time / w.kos : 0;

                                    return (
                                      <div
                                        key={idx}
                                        className="p-3 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors"
                                      >
                                        {/* Header */}
                                        <div className="flex items-center gap-2 mb-3">
                                          <img
                                            src={getWeaponIcon(w.name)}
                                            alt={w.name}
                                            className="h-6 w-6 object-contain"
                                          />
                                          <span className="text-xs font-bold text-foreground uppercase">
                                            {getWeaponDisplay(w.name)}
                                          </span>
                                        </div>

                                        {/* Stats */}
                                        <div className="space-y-2 text-[11px]">
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">
                                              KOs
                                            </span>
                                            <span className="font-bold text-foreground">
                                              {formatNum(w.kos)}{' '}
                                              <span className="text-muted-foreground font-normal">
                                                ({kosPercent.toFixed(1)}%)
                                              </span>
                                            </span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">
                                              Damage
                                            </span>
                                            <span className="font-bold text-foreground">
                                              {formatCompact(w.dmg)}{' '}
                                              <span className="text-muted-foreground font-normal">
                                                ({dmgPercent.toFixed(1)}%)
                                              </span>
                                            </span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">
                                              Time held
                                            </span>
                                            <span className="font-bold text-foreground">
                                              {formatHours(w.time)}{' '}
                                              <span className="text-muted-foreground font-normal">
                                                ({timePercent.toFixed(1)}%)
                                              </span>
                                            </span>
                                          </div>
                                          <div className="flex justify-between pt-1 border-t border-border/20">
                                            <span className="text-muted-foreground">
                                              DPS
                                            </span>
                                            <span className="font-bold text-foreground">
                                              {weaponDps.toFixed(1)}
                                            </span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">
                                              Time to KO
                                            </span>
                                            <span className="font-bold text-foreground">
                                              {weaponTimeToKill.toFixed(1)}s
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                  </div>
                </div>
              );
            })}
          </Card>

          {allLegends.length > 5 && (
            <div className="flex justify-center mt-6">
              <Button
                variant="outline"
                onClick={handleToggleLegends}
                className="gap-2"
              >
                {showAllLegends ? (
                  <>
                    Show Less <ChevronUp className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Show All Legends <ChevronDown className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Teams */}
      {rankedTeams && rankedTeams.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <h2 className="text-2xl font-bold text-foreground">2v2 Teams</h2>
            <span className="text-sm text-muted-foreground font-mono">
              Teams: {rankedTeams.length}
            </span>
          </div>

          <Card className="bg-linear-to-br from-card to-background border-border">
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wide">
                    Total Games
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-foreground mt-1">
                    {formatNum(teamsTotals.games)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wide">
                    Total Wins
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-foreground mt-1">
                    {formatNum(teamsTotals.wins)}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-end">
                    <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wide">
                      Overall Win Rate
                    </div>
                    <div className="text-xl sm:text-2xl font-black text-foreground">
                      {teamsWinrate.toFixed(1)}%
                    </div>
                  </div>
                  <WinLossBar percent={teamsWinrate} className="h-3" />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {rankedTeams.map((team: any) => {
              const idNumber = parseInt(id, 10);
              const teammateId =
                team.brawlhallaIdOne === idNumber
                  ? team.brawlhallaIdTwo
                  : team.brawlhallaIdOne;
              const teammateHref = `/player/${teammateId}`;
              const bannerUrl = getRankBanner(team.tier);

              const teamNameParts = fixEncoding(team.teamName).split('+');
              const teammateNameIndex =
                team.brawlhallaIdOne === parseInt(id) ? 1 : 0;
              const teammateName =
                teamNameParts[teammateNameIndex]?.trim() ||
                teamNameParts
                  .find((part) => part.trim() !== fixEncoding(player.name))
                  ?.trim() ||
                fixEncoding(team.teamName);

              return (
                <Link
                  key={`${team.brawlhallaIdOne}-${team.brawlhallaIdTwo}`}
                  href={teammateHref}
                  className="group flex items-stretch rounded-xl bg-card border border-border hover:border-primary transition-colors cursor-pointer min-h-36 relative mt-4 min-w-0"
                >
                  {/* Rank Banner on Left - Bleeding Out */}
                  <div className="absolute -top-0.5 left-2 sm:left-4 w-16 sm:w-24 h-[120%] z-20 pointer-events-none filter drop-shadow-xl">
                    <div
                      className="w-full h-full bg-top bg-no-repeat bg-contain transition-transform duration-300"
                      style={{ backgroundImage: `url(${bannerUrl})` }}
                    />
                  </div>

                  {/* Content Spacer for Banner */}
                  <div className="w-20 sm:w-32 shrink-0" />

                  {/* Content */}
                  <div className="flex-1 p-3 sm:p-4 flex flex-col justify-between min-w-0 overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 sm:gap-4">
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <h3 className="font-bold text-foreground text-lg leading-tight group-hover:text-primary transition-colors truncate">
                          {teammateName}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs font-mono text-muted-foreground truncate">
                            Teammate ID: {teammateId}
                          </span>
                        </div>
                      </div>

                      <div className="flex justify-start sm:justify-end shrink-0 mt-2 sm:mt-0">
                        <div className="text-left sm:text-right shrink-0 flex items-baseline justify-start sm:justify-end gap-2 sm:block sm:gap-0">
                          <div className="text-xl sm:text-2xl font-black text-chart-3 leading-none whitespace-nowrap">
                            {team.rating}
                            <span className="text-xs sm:text-sm font-medium text-muted-foreground ml-1.5 align-baseline opacity-80">
                              / {team.peakRating}
                            </span>
                          </div>
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider sm:mt-1">
                            {team.tier}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          Wins / Games
                        </span>
                        <div className="flex items-baseline gap-1">
                          <span className="text-foreground font-mono font-bold">
                            {team.wins}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            / {team.games}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col text-right">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          Win Rate
                        </span>
                        <span
                          className={`font-mono font-bold ${
                            team.games > 0 && team.wins / team.games > 0.5
                              ? 'text-green-500'
                              : 'text-foreground'
                          }`}
                        >
                          {team.games > 0
                            ? ((team.wins / team.games) * 100).toFixed(1)
                            : 0}
                          %
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
