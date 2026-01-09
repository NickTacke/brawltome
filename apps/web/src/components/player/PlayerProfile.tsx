'use client';

import { useState, useRef, useEffect } from 'react';
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

interface PlayerProfileProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData: any;
  id: string;
}

const RANK_BANNERS: Record<string, string> = {
  Diamond: '/images/banners/Diamond.png',
  Platinum: '/images/banners/Platinum.png',
  Gold: '/images/banners/Gold.png',
  Silver: '/images/banners/Silver.png',
  Bronze: '/images/banners/Bronze.png',
  Tin: '/images/banners/Tin.png',
  Valhallan: '/images/banners/Valhallan.png',
};

const getRankBanner = (tier?: string | null) => {
  const baseTier = (tier ?? '').split(' ')[0];
  return RANK_BANNERS[baseTier] || '/images/banners/Unranked.png';
};

const getWeaponIcon = (weapon: string) => {
  // Brawlhalla weapons mapped to image folder names
  const map: Record<string, string> = {
    unarmed: 'Unarmed',
    Axe: 'Axe',
    'Battle Boots': 'Boots',
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
    Chakrams: 'Chakram',
    Gadgets: 'Gadgets',
  };
  return `/images/weapons/${map[weapon] || weapon.toLowerCase()}.png`;
};

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
};

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

const StatItem = ({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) => {
  const displayValue =
    typeof value === 'number' && isNaN(value) ? '---' : String(value);

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-bold text-muted-foreground opacity-60">
        {label}
      </div>
      <div className="font-mono font-bold text-foreground text-sm leading-none">
        {displayValue}
      </div>
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

  // Rich weapon aggregation
  interface WeaponAgg {
    weapon: string;
    label?: string;
    games: number;
    wins: number;
    xp: number;
    totalLevel: number;
    legendCount: number;
    timeHeld: number;
    KOs: number;
    damage: number;
    share?: number;
    usageRate?: number;
    ranked: {
      games: number;
      wins: number;
      ratings: number[];
      peakRatings: number[];
      mostPlayed: { name: string; games: number; key: string };
      highestElo: { name: string; elo: number; key: string };
      highestPeak: { name: string; elo: number; key: string };
    };
  }

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

  const weaponStatsMap = new Map<string, WeaponAgg>();

  if (player?.stats?.legendsEnriched) {
    player.stats.legendsEnriched.forEach((l: Record<string, any>) => {
      const weapons = [
        {
          name: l.weaponOne as string,
          time: l.timeHeldWeaponOne as number,
          kos: l.KOWeaponOne as number,
          dmg: l.damageWeaponOne as string,
        },
        {
          name: l.weaponTwo as string,
          time: l.timeHeldWeaponTwo as number,
          kos: l.KOWeaponTwo as number,
          dmg: l.damageWeaponTwo as string,
        },
      ];

      weapons.forEach((w) => {
        if (!w.name) return;
        const current = weaponStatsMap.get(w.name) || {
          weapon: w.name,
          games: 0,
          wins: 0,
          xp: 0,
          totalLevel: 0,
          legendCount: 0,
          timeHeld: 0,
          KOs: 0,
          damage: 0,
          ranked: {
            games: 0,
            wins: 0,
            ratings: [],
            peakRatings: [],
            mostPlayed: { name: '', games: 0, key: '' },
            highestElo: { name: '', elo: 0, key: '' },
            highestPeak: { name: '', elo: 0, key: '' },
          },
        };

        current.games += parseNum(l.games);
        current.wins += parseNum(l.wins);
        current.xp += parseNum(l.xp);
        current.totalLevel += parseNum(l.level);
        current.legendCount += 1;
        current.timeHeld += parseNum(w.time);
        current.KOs += parseNum(w.kos);
        current.damage += parseNum(w.dmg);

        // Track most played legend for this weapon
        if (parseNum(l.games) > current.ranked.mostPlayed.games) {
          current.ranked.mostPlayed = {
            name: (l.bioName || l.legendNameKey) as string,
            games: parseNum(l.games),
            key: l.legendNameKey as string,
          };
        }

        if (l.ranked) {
          current.ranked.games += parseNum(l.ranked.games);
          current.ranked.wins += parseNum(l.ranked.wins);
          current.ranked.ratings.push(parseNum(l.ranked.rating));
          current.ranked.peakRatings.push(parseNum(l.ranked.peakRating));

          if (parseNum(l.ranked.rating) > current.ranked.highestElo.elo) {
            current.ranked.highestElo = {
              name: (l.bioName || l.legendNameKey) as string,
              elo: parseNum(l.ranked.rating),
              key: l.legendNameKey as string,
            };
          }
          if (parseNum(l.ranked.peakRating) > current.ranked.highestPeak.elo) {
            current.ranked.highestPeak = {
              name: (l.bioName || l.legendNameKey) as string,
              elo: parseNum(l.ranked.peakRating),
              key: l.legendNameKey as string,
            };
          }
        }

        weaponStatsMap.set(w.name, current);
      });
    });
  }

  const totalTimeHeld = Array.from(weaponStatsMap.values()).reduce(
    (sum, w) => sum + w.timeHeld,
    0
  );
  const totalGamesAcrossWeapons = Array.from(weaponStatsMap.values()).reduce(
    (sum, w) => sum + w.games,
    0
  );

  const weaponStats = Array.from(weaponStatsMap.values())
    .map((w) => ({
      ...w,
      share: totalTimeHeld > 0 ? w.timeHeld / totalTimeHeld : 0,
      usageRate:
        totalGamesAcrossWeapons > 0 ? w.games / totalGamesAcrossWeapons : 0,
    }))
    .filter((w) => w.timeHeld > 0 || w.damage > 0 || w.KOs > 0)
    .sort((a, b) => b.timeHeld - a.timeHeld);

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
              const avgDmg = w.games > 0 ? parseNum(w.damage) / w.games : 0;

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
                      <div className="h-10 w-10 relative shrink-0">
                        <img
                          src={getWeaponIcon(w.weapon)}
                          alt={w.weapon}
                          className="object-contain w-full h-full opacity-90"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <h3 className="font-bold text-foreground truncate text-sm">
                            {w.label || getWeaponDisplay(w.weapon)}
                          </h3>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5">
                            {(w.share * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground font-mono flex items-center gap-1.5 truncate">
                          <span>{formatHours(w.timeHeld)} held</span>
                          <span className="opacity-30">•</span>
                          <span>{formatNum(w.KOs)} KOs</span>
                          <span className="opacity-30">•</span>
                          <span>{formatNum(w.damage)} dmg</span>
                        </div>
                        <Progress value={w.share * 100} className="h-1 mt-2" />
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="pt-6 space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
                        {/* Banner Section */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div className="space-y-4">
                            <div>
                              <div className="text-[10px] font-bold text-muted-foreground mb-1 opacity-70">
                                Games
                              </div>
                              <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-black text-foreground tracking-tighter">
                                  {formatNum(w.games)}
                                </span>
                                <span className="text-xs font-bold text-muted-foreground">
                                  Games
                                </span>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="flex justify-between items-end text-[10px] font-mono">
                                <span className="text-green-500 font-bold">
                                  {formatNum(w.wins)}W ({winrate.toFixed(2)}%)
                                </span>
                                <span className="text-red-500 font-bold">
                                  {formatNum(w.games - w.wins)}L (
                                  {(100 - winrate).toFixed(2)}%)
                                </span>
                              </div>
                              <WinLossBar
                                percent={winrate}
                                className="h-2 shadow-inner"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <StatItem
                              label="Weapon level"
                              value={formatNum(w.totalLevel)}
                            />
                            <StatItem
                              label="Avg. legend level"
                              value={
                                w.legendCount > 0
                                  ? Math.round(w.totalLevel / w.legendCount)
                                  : 0
                              }
                            />
                            <StatItem
                              label="Weapon XP"
                              value={formatNum(w.xp)}
                            />
                            <StatItem
                              label="Avg. legend XP"
                              value={formatNum(
                                w.legendCount > 0
                                  ? Math.round(w.xp / w.legendCount)
                                  : 0
                              )}
                            />
                          </div>
                        </div>

                        {/* Main Stats Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-y-6 gap-x-4">
                          <StatItem
                            label="Time held"
                            value={formatHours(w.timeHeld)}
                          />
                          <StatItem
                            label="Time held (%)"
                            value={`${(w.share * 100).toFixed(2)}%`}
                          />
                          <StatItem
                            label="Usage rate"
                            value={`${(w.usageRate * 100).toFixed(2)}%`}
                          />
                          <StatItem label="KOs" value={formatNum(w.KOs)} />
                          <StatItem
                            label="Avg. KOs/game"
                            value={avgKos.toFixed(2)}
                          />
                          <StatItem
                            label="Damage Dealt"
                            value={formatNum(w.damage)}
                          />
                          <StatItem
                            label="DPS"
                            value={`${dps.toFixed(2)} dmg/s`}
                          />
                          <StatItem
                            label="Avg. dmg/game"
                            value={avgDmg.toFixed(2)}
                          />
                        </div>

                        {/* Ranked Season */}
                        <div className="pt-6 space-y-6">
                          <h4 className="text-sm font-black text-foreground/80 uppercase tracking-wider">
                            Ranked Season Performance
                          </h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-y-6 gap-x-4">
                            <StatItem
                              label="Games"
                              value={formatNum(w.ranked.games)}
                            />
                            <StatItem
                              label="Wins"
                              value={formatNum(w.ranked.wins)}
                            />
                            <StatItem
                              label="Losses"
                              value={formatNum(w.ranked.games - w.ranked.wins)}
                            />
                            <StatItem
                              label="Winrate"
                              value={
                                w.ranked.games > 0
                                  ? `${(
                                      (w.ranked.wins / w.ranked.games) *
                                      100
                                    ).toFixed(2)}%`
                                  : '0%'
                              }
                            />
                            <StatItem
                              label="Avg Elo"
                              value={Math.round(avgElo)}
                            />

                            <div className="col-span-1 space-y-1">
                              <div className="text-[10px] font-bold text-muted-foreground opacity-60">
                                Most played
                              </div>
                              {w.ranked.mostPlayed.key ? (
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-5 w-5 rounded-sm">
                                    <AvatarImage
                                      src={`/images/legends/avatars/${w.ranked.mostPlayed.key}.png`}
                                    />
                                  </Avatar>
                                  <span className="text-xs font-bold truncate">
                                    {w.ranked.mostPlayed.games} games
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs">---</span>
                              )}
                            </div>

                            <div className="col-span-1 space-y-1">
                              <div className="text-[10px] font-bold text-muted-foreground opacity-60">
                                Highest Elo
                              </div>
                              {w.ranked.highestElo.key ? (
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-5 w-5 rounded-sm">
                                    <AvatarImage
                                      src={`/images/legends/avatars/${w.ranked.highestElo.key}.png`}
                                    />
                                  </Avatar>
                                  <span className="text-xs font-bold truncate">
                                    {w.ranked.highestElo.elo} elo
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs">---</span>
                              )}
                            </div>

                            <div className="col-span-1 space-y-1">
                              <div className="text-[10px] font-bold text-muted-foreground opacity-60">
                                Highest peak Elo
                              </div>
                              {w.ranked.highestPeak.key ? (
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-5 w-5 rounded-sm">
                                    <AvatarImage
                                      src={`/images/legends/avatars/${w.ranked.highestPeak.key}.png`}
                                    />
                                  </Avatar>
                                  <span className="text-xs font-bold truncate">
                                    {w.ranked.highestPeak.elo} elo
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs">---</span>
                              )}
                            </div>

                            <StatItem
                              label="Avg peak Elo"
                              value={Math.round(avgPeak)}
                            />
                          </div>
                        </div>
                      </div>
                    )}
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
                        <div className="flex justify-between items-start gap-2">
                          <h3 className="font-bold capitalize truncate text-sm">
                            {legend.bioName || legend.legendNameKey}
                          </h3>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge
                              variant="secondary"
                              className="text-[10px] font-mono px-1.5 h-5"
                            >
                              Lvl {legend.level}
                            </Badge>
                            {legend.ranked && !isExpanded && (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-mono text-muted-foreground whitespace-nowrap px-1.5 h-5"
                              >
                                {legend.ranked.tier} • {legend.ranked.rating}
                              </Badge>
                            )}
                          </div>
                        </div>
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
                    </div>

                    {isExpanded && (
                      <div className="pt-6 space-y-8 animate-in fade-in slide-in-from-top-2 duration-300 relative z-10">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-6 gap-x-4">
                          <StatItem label="KOs" value={formatNum(legend.KOs)} />
                          <StatItem
                            label="Falls / Suicides"
                            value={`${formatNum(legend.falls)} / ${formatNum(
                              legend.suicides
                            )}`}
                          />
                          <StatItem
                            label="Damage Dealt"
                            value={formatNum(legend.damageDealt)}
                          />
                          <StatItem
                            label="Damage Taken"
                            value={formatNum(legend.damageTaken)}
                          />
                        </div>

                        <div className="space-y-4">
                          <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            Weapon Mastery
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {[
                              {
                                name: legend.weaponOne,
                                time: legend.timeHeldWeaponOne,
                                kos: legend.KOWeaponOne,
                                dmg: legend.damageWeaponOne,
                              },
                              {
                                name: legend.weaponTwo,
                                time: legend.timeHeldWeaponTwo,
                                kos: legend.KOWeaponTwo,
                                dmg: legend.damageWeaponTwo,
                              },
                              {
                                name: 'Unarmed',
                                time: Math.max(
                                  0,
                                  parseNum(legend.matchTime) -
                                    parseNum(legend.timeHeldWeaponOne) -
                                    parseNum(legend.timeHeldWeaponTwo)
                                ),
                                kos: legend.KOUnarmed,
                                dmg: legend.damageUnarmed,
                              },
                            ].map((w, idx) => {
                              if (!w.name && idx < 2) return null;
                              const weaponName = w.name || 'Unknown';
                              const kos = parseNum(w.kos);
                              const dmg = parseNum(w.dmg);

                              if (idx >= 2 && kos === 0 && dmg === 0)
                                return null;

                              return (
                                <div
                                  key={idx}
                                  className="flex items-center gap-3 p-3 rounded-lg bg-background/30 hover:bg-background/50 transition-colors"
                                >
                                  <div className="h-8 w-8 relative shrink-0">
                                    <img
                                      src={getWeaponIcon(weaponName)}
                                      alt={weaponName}
                                      className="object-contain w-full h-full opacity-80"
                                    />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="font-bold text-foreground text-[10px] truncate mb-0.5">
                                      {getWeaponDisplay(weaponName)}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-2">
                                      {w.time !== null && (
                                        <span>
                                          {formatHours(parseNum(w.time))}
                                        </span>
                                      )}
                                      <span className="text-foreground/80">
                                        {formatNum(kos)} KOs
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {legend.ranked && (
                          <div className="pt-6 space-y-6 flex flex-col">
                            <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                              Ranked Season
                            </h4>
                            <div className="flex items-center gap-8">
                              <div className="h-24 w-16 relative shrink-0 flex items-center justify-center">
                                <img
                                  src={getRankBanner(legend.ranked.tier)}
                                  alt=""
                                  className="w-full h-full object-contain pointer-events-none drop-shadow-lg"
                                />
                              </div>
                              <div className="flex items-baseline gap-4">
                                <span className="text-5xl sm:text-7xl font-black text-foreground tracking-tighter">
                                  {legend.ranked.rating}
                                </span>
                                <span className="text-3xl sm:text-5xl font-bold text-muted-foreground/30 tracking-tight">
                                  / {legend.ranked.peakRating}
                                </span>
                                <span className="text-base sm:text-2xl font-medium text-muted-foreground">
                                  ELO
                                </span>
                              </div>
                            </div>

                            <div className="pt-6">
                              <div className="flex justify-between items-end mb-2">
                                <div className="text-muted-foreground text-sm font-medium uppercase tracking-wide">
                                  Win Rate
                                </div>
                                <div
                                  className={`text-xl sm:text-2xl font-black ${
                                    legend.ranked.games > 0 &&
                                    (legend.ranked.wins / legend.ranked.games) *
                                      100 >=
                                      50
                                      ? 'text-green-500'
                                      : 'text-foreground'
                                  }`}
                                >
                                  {legend.ranked.games > 0
                                    ? (
                                        (legend.ranked.wins /
                                          legend.ranked.games) *
                                        100
                                      ).toFixed(1)
                                    : '0.0'}
                                  %
                                </div>
                              </div>
                              <WinLossBar
                                percent={
                                  legend.ranked.games > 0
                                    ? (legend.ranked.wins /
                                        legend.ranked.games) *
                                      100
                                    : 0
                                }
                                className="h-4"
                              />
                              <div className="flex justify-between text-xs text-muted-foreground mt-2 font-mono">
                                <span>{legend.ranked.wins} Wins</span>
                                <span>
                                  {legend.ranked.games - legend.ranked.wins}{' '}
                                  Losses
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
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
