'use client';

import { useState } from 'react';
import Link from 'next/link';
import { fixEncoding, timeAgo } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Skeleton,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Input,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@brawltome/ui';
import {
  ChevronLeft,
  Users,
  Trophy,
  Calendar,
  Crown,
  Shield,
  User,
  UserPlus,
  Search,
  TrendingUp,
  Clock,
} from 'lucide-react';
import { ModeToggle } from '@/components/mode-toggle';

const PAGE_SIZE = 25;

interface ClanProfileProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData: any; // We can improve typing later
  id: string;
}

export function ClanProfile({ initialData: clan, id }: ClanProfileProps) {
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'rating' | 'peakRating'>(
    'default'
  );

  const isLoading = !clan;

  const formatJoinedDate = (value: string | Date) => {
    const d = new Date(value);
    // Non-ambiguous, human-readable (avoids MM/DD/YYYY confusion)
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d);
  };

  const getRankIcon = (rank: string) => {
    switch (rank.toLowerCase()) {
      case 'leader':
        return <Crown className="w-5 h-5 text-yellow-500" />;
      case 'officer':
        return <Shield className="w-4 h-4 text-blue-400 fill-current" />;
      case 'member':
        return <User className="w-4 h-4 text-emerald-400" />;
      case 'recruit':
        return <UserPlus className="w-4 h-4 text-muted-foreground/50" />;
      default:
        return <User className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getRankValue = (rank: string) => {
    switch (rank.toLowerCase()) {
      case 'leader':
        return 4;
      case 'officer':
        return 3;
      case 'member':
        return 2;
      case 'recruit':
        return 1;
      default:
        return 0;
    }
  };

  const filteredMembers =
    clan?.members?.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m: any) =>
        !searchTerm ||
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.brawlhallaId.toString().includes(searchTerm)
    ) || [];

  // Sort AFTER filtering, BEFORE pagination
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortedMembers = [...filteredMembers].sort((a: any, b: any) => {
    if (sortBy === 'rating' || sortBy === 'peakRating') {
      const aElo = typeof a.elo === 'number' && a.elo > 0 ? a.elo : null;
      const bElo = typeof b.elo === 'number' && b.elo > 0 ? b.elo : null;
      const aPeak =
        typeof a.peakElo === 'number' && a.peakElo > 0 ? a.peakElo : null;
      const bPeak =
        typeof b.peakElo === 'number' && b.peakElo > 0 ? b.peakElo : null;

      const aVal = sortBy === 'peakRating' ? aPeak : aElo;
      const bVal = sortBy === 'peakRating' ? bPeak : bElo;

      // Unknown Elo always last, regardless of direction
      if (aVal === null && bVal !== null) return 1;
      if (aVal !== null && bVal === null) return -1;

      // Descending (leaderboard-style)
      if (aVal !== null && bVal !== null && aVal !== bVal) {
        return bVal - aVal;
      }
      // Tie-breakers for deterministic ordering
      const rankDiff = getRankValue(b.rank) - getRankValue(a.rank);
      if (rankDiff !== 0) return rankDiff;
      const joinDiff =
        new Date(a.joinDate).getTime() - new Date(b.joinDate).getTime();
      if (joinDiff !== 0) return joinDiff;
      return String(a.name).localeCompare(String(b.name));
    }

    // Default sort: Rank (desc) then join date (oldest first)
    const rankDiff = getRankValue(b.rank) - getRankValue(a.rank);
    if (rankDiff !== 0) return rankDiff;
    return new Date(a.joinDate).getTime() - new Date(b.joinDate).getTime();
  });

  const totalPages = Math.ceil(sortedMembers.length / PAGE_SIZE);
  const paginatedMembers = sortedMembers.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Top Navbar */}
      <div className="flex justify-between items-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
        >
          <ChevronLeft className="w-5 h-5" />
          Back to Search
        </Link>
        <ModeToggle />
      </div>

      {/* Header */}
      <div className="flex flex-col gap-6">
        <div>
          {isLoading ? (
            <Skeleton className="h-16 w-3/4 max-w-lg mb-2" />
          ) : (
            <h1 className="text-4xl sm:text-6xl font-black text-foreground tracking-tight">
              {fixEncoding(clan.clanName)}
            </h1>
          )}

          <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-mono">ID: {id}</span>
            </div>
            <span>•</span>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              {isLoading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                <span>
                  Created {new Date(clan.clanCreateDate).toLocaleDateString()}
                </span>
              )}
            </div>
            {clan?.lastUpdated && (
              <>
                <span>•</span>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-xs font-mono text-muted-foreground gap-1.5 hover:bg-muted/50 transition-colors"
                  >
                    <Clock className="w-3 h-3" />
                    <span className="hidden sm:inline">Updated </span>
                    {timeAgo(clan.lastUpdated)}
                  </Badge>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total XP
              </CardTitle>
              <Trophy className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold">
                  {clan.clanXp ? parseInt(clan.clanXp).toLocaleString() : '0'}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Members
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <div className="text-2xl font-bold">
                  {clan.members?.length || 0}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Average XP
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold">
                  {clan.members?.length > 0
                    ? Math.round(
                        parseInt(clan.clanXp || '0') / clan.members.length
                      ).toLocaleString()
                    : '0'}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Members List */}
      <Card className="bg-card/50 backdrop-blur-xs border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-yellow-500">🏆</span> Clan Members
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-bold uppercase">
                Sort:
              </span>
              <Select
                value={sortBy}
                onValueChange={(v) => {
                  setSortBy(v as typeof sortBy);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[140px] font-bold h-9">
                  <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default" className="cursor-pointer">
                    Clan Rank
                  </SelectItem>
                  <SelectItem value="rating" className="cursor-pointer">
                    Elo
                  </SelectItem>
                  <SelectItem value="peakRating" className="cursor-pointer">
                    Peak Elo
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search members..."
                className="pl-8 h-9"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(1); // Reset to page 1 on search
                }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-[60px] font-bold text-center">
                  Rank
                </TableHead>
                <TableHead className="font-bold">Player</TableHead>
                <TableHead className="text-right font-bold">
                  <span className="inline-flex items-center gap-1">
                    Elo
                    {sortBy === 'rating' && (
                      <span className="text-xs text-muted-foreground">↓</span>
                    )}
                    {sortBy === 'peakRating' && (
                      <span className="text-xs text-muted-foreground">
                        (Peak) ↓
                      </span>
                    )}
                  </span>
                </TableHead>
                <TableHead className="text-right font-bold">
                  XP / Contribution
                </TableHead>
                <TableHead className="text-right font-bold hidden sm:table-cell">
                  Joined
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? // Skeleton Loading State
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow
                      key={i}
                      className="border-border hover:bg-transparent"
                    >
                      <TableCell className="p-4">
                        <Skeleton className="h-6 w-16" />
                      </TableCell>
                      <TableCell className="p-4">
                        <Skeleton className="h-6 w-32" />
                      </TableCell>
                      <TableCell className="p-4">
                        <Skeleton className="h-6 w-16 ml-auto" />
                      </TableCell>
                      <TableCell className="p-4">
                        <Skeleton className="h-6 w-24 ml-auto" />
                      </TableCell>
                      <TableCell className="p-4 hidden sm:table-cell">
                        <Skeleton className="h-6 w-24 ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                : // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  paginatedMembers.map((member: any) => {
                    const totalClanXp = parseInt(clan.clanXp) || 1;
                    const contribution = (member.xp / totalClanXp) * 100;
                    const href = `/player/${member.brawlhallaId}`;
                    const elo =
                      typeof member.elo === 'number' && member.elo > 0
                        ? member.elo
                        : null;
                    const peakElo =
                      typeof member.peakElo === 'number' && member.peakElo > 0
                        ? member.peakElo
                        : null;

                    return (
                      <TableRow
                        key={member.brawlhallaId}
                        className="border-border hover:bg-muted/50 transition-colors h-16 group"
                      >
                        <TableCell className="p-0">
                          <Link href={href} className="block w-full h-full p-4">
                            <div className="flex items-center justify-center">
                              {getRankIcon(member.rank)}
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell className="p-0">
                          <Link href={href} className="block w-full h-full p-4">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10 border border-border bg-muted rounded-md">
                                <AvatarImage
                                  src={
                                    member.legendNameKey
                                      ? `/images/legends/avatars/${member.legendNameKey.toLowerCase()}.png`
                                      : undefined
                                  }
                                  alt={member.legendNameKey || 'Legend'}
                                  className="object-cover object-top"
                                  loading="lazy"
                                />
                                <AvatarFallback className="text-[10px] uppercase font-bold text-muted-foreground rounded-md">
                                  {fixEncoding(member.name).substring(0, 2)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-bold text-lg text-foreground group-hover:text-primary transition-colors">
                                {fixEncoding(member.name)}
                              </span>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell className="p-0 text-right font-mono">
                          <Link href={href} className="block w-full h-full p-4">
                            {elo === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-col items-end leading-tight">
                                <span className="font-bold">{elo}</span>
                                {peakElo !== null && (
                                  <span className="text-xs text-muted-foreground">
                                    Peak {peakElo}
                                  </span>
                                )}
                              </div>
                            )}
                          </Link>
                        </TableCell>
                        <TableCell className="p-0 text-right font-mono">
                          <Link href={href} className="block w-full h-full p-4">
                            <div className="flex flex-col items-end leading-tight">
                              <span className="font-bold">
                                {member.xp.toLocaleString()}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {contribution.toFixed(1)}%
                              </span>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell className="p-0 text-right text-muted-foreground text-sm hidden sm:table-cell">
                          <Link href={href} className="block w-full h-full p-4">
                            {formatJoinedDate(member.joinDate)}
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
        </CardContent>
        {/* Pagination */}
        {!isLoading && totalPages > 1 && (
          <div className="p-4 border-t border-border flex justify-between items-center bg-muted/20">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-mono">
                Page
              </span>
              <Input
                key={page}
                defaultValue={page}
                className="h-8 w-16 text-center font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseInt(e.currentTarget.value);
                    if (!isNaN(val) && val >= 1 && val <= totalPages) {
                      setPage(val);
                    }
                  }
                }}
              />
              <span className="text-sm text-muted-foreground font-mono">
                of {totalPages}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
