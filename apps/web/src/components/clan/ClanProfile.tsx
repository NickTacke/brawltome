'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  const isLoading = !clan;

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

  const sortedMembers =
    clan?.members

      ?.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m: any) =>
          !searchTerm ||
          m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          m.brawlhallaId.toString().includes(searchTerm)
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?.sort((a: any, b: any) => {
        const rankDiff = getRankValue(b.rank) - getRankValue(a.rank);
        if (rankDiff !== 0) return rankDiff;
        // Secondary sort by join date (oldest first)
        return new Date(a.joinDate).getTime() - new Date(b.joinDate).getTime();
      }) || [];

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
      <Card className="bg-card/50 backdrop-blur-sm border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-yellow-500">🏆</span> Clan Members
          </CardTitle>
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
                  Contribution
                </TableHead>
                <TableHead className="text-right font-bold">XP</TableHead>
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
                      <TableCell className="p-4 flex justify-end">
                        <Skeleton className="h-6 w-12" />
                      </TableCell>
                      <TableCell className="p-4">
                        <Skeleton className="h-6 w-16 ml-auto" />
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

                    return (
                      <TableRow
                        key={member.brawlhallaId}
                        className="cursor-pointer border-border hover:bg-muted/50 transition-colors h-16"
                        onClick={() =>
                          router.push(`/player/${member.brawlhallaId}`)
                        }
                      >
                        <TableCell>
                          <div className="flex items-center justify-center">
                            {getRankIcon(member.rank)}
                          </div>
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {contribution.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold">
                          {member.xp.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm hidden sm:table-cell">
                          {new Date(member.joinDate).toLocaleDateString()}
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
