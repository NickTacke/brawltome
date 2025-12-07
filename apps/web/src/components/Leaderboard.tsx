'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { fetcher } from '@/lib/api';
import { fixEncoding } from '@/lib/utils';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  Skeleton,
  Card,
  Badge,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Input
} from '@brawltome/ui';

const REGIONS = [
  { id: 'all', label: 'Global' },
  { id: 'US-E', label: 'US-E' },
  { id: 'US-W', label: 'US-W' },
  { id: 'EU', label: 'Europe' },
  { id: 'SEA', label: 'SEA' },
  { id: 'AUS', label: 'AUS' },
  { id: 'BRZ', label: 'Brazil' },
  { id: 'JPN', label: 'Japan' },
  { id: 'ME', label: 'Middle East' },
  { id: 'SA', label: 'South Africa' },
];

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { id: 'rating', label: 'Elo' },
  { id: 'peakRating', label: 'Peak Elo' },
  { id: 'wins', label: 'Wins' },
  { id: 'games', label: 'Games' },
];

export function Leaderboard() {
  const [page, setPage] = useState(1);
  const [region, setRegion] = useState('all');
  const [sortBy, setSortBy] = useState('rating');
  const router = useRouter();

  const { data, isLoading, error } = useSWR(
    `/player/leaderboard/${page}?region=${region}&sort=${sortBy}&limit=${PAGE_SIZE}`,
    fetcher
  );

  const players = data?.data || [];
  const totalPages = data?.meta?.totalPages || 1;

  if (error) {
    return (
      <Card className="w-full max-w-4xl mx-auto mt-12 bg-destructive/10 border-destructive text-destructive-foreground p-6 text-center">
          Error loading leaderboard: {error.message}
      </Card>
    );
  }

  const handleRegionChange = (newRegion: string) => {
    setRegion(newRegion);
    setPage(1); // Reset to page 1 on filter change
  };

  const handleSortChange = (newSort: string) => {
    setSortBy(newSort);
    setPage(1); // Reset to page 1 on filter change
  };

  const getRankStyle = (rank: number) => {
    if (rank === 1) return "text-yellow-500 font-black text-xl";
    if (rank === 2) return "text-slate-400 font-black text-xl";
    if (rank === 3) return "text-amber-700 font-black text-xl";
    return "text-muted-foreground font-mono";
  };

  return (
    <Card className="w-full max-w-5xl mx-auto mt-12 bg-card/50 backdrop-blur-sm border-border">
      {/* Header */}
      <div className="p-6 border-b border-border flex flex-col sm:flex-row justify-between items-center gap-4">
        <h2 className="text-2xl font-bold text-card-foreground flex items-center gap-2">
          <span className="text-yellow-500">🏆</span> Leaderboard
        </h2>
        
        <div className="flex flex-col sm:flex-row items-center gap-4">
            {/* Sort Filter */}
            <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground font-bold uppercase">Sort:</span>
                <Select value={sortBy} onValueChange={handleSortChange}>
                <SelectTrigger className="w-[140px] font-bold">
                    <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent>
                    {SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.id} value={o.id} className="cursor-pointer">
                        {o.label}
                    </SelectItem>
                    ))}
                </SelectContent>
                </Select>
            </div>

            {/* Region Filter */}
            <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground font-bold uppercase">Region:</span>
                <Select value={region} onValueChange={handleRegionChange}>
                <SelectTrigger className="w-[180px] font-bold">
                    <SelectValue placeholder="Select Region" />
                </SelectTrigger>
                <SelectContent>
                    {REGIONS.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="cursor-pointer">
                        {r.label}
                    </SelectItem>
                    ))}
                </SelectContent>
                </Select>
            </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-20 text-center font-bold">Rank</TableHead>
              <TableHead className="font-bold">Player</TableHead>
              <TableHead className="text-center font-bold">Rating</TableHead>
              <TableHead className="text-center font-bold">Win Rate</TableHead>
              <TableHead className="text-center hidden sm:table-cell font-bold">Wins</TableHead>
              <TableHead className="text-center hidden sm:table-cell font-bold">Games</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // Skeleton Loading State
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i} className="border-border hover:bg-transparent">
                  <TableCell className="p-4"><Skeleton className="h-6 w-8 mx-auto" /></TableCell>
                  <TableCell className="p-4">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-3 w-20" />
                  </TableCell>
                  <TableCell className="p-4"><Skeleton className="h-6 w-16 mx-auto" /></TableCell>
                  <TableCell className="p-4"><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                  <TableCell className="p-4 hidden sm:table-cell"><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
                  <TableCell className="p-4 hidden sm:table-cell"><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
                </TableRow>
              ))
            ) : players.length > 0 ? (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              players.map((p: any, i: number) => {
                const globalRank = ((page - 1) * PAGE_SIZE) + i + 1;
                const winrate = p.games > 0 ? (p.wins / p.games) * 100 : 0;
                
                return (
                <TableRow 
                  key={p.brawlhallaId}
                  onClick={() => router.push(`/player/${p.brawlhallaId}`)}
                  className="border-border cursor-pointer transition-colors group h-16"
                >
                  <TableCell className={`text-center ${getRankStyle(globalRank)}`}>
                    #{globalRank}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                        {/* Best Legend Avatar */}
                        {p.bestLegendName && (
                            <Avatar className="h-10 w-10 border border-border bg-muted">
                                <AvatarImage 
                                    src={`/images/legends/${p.bestLegendName}.png`} 
                                    alt={p.bestLegendName} 
                                    className="object-cover"
                                    loading="lazy"
                                />
                                <AvatarFallback className="text-[10px] uppercase font-bold text-muted-foreground">
                                    {p.bestLegendName.substring(0, 2)}
                                </AvatarFallback>
                            </Avatar>
                        )}
                        <div className="flex flex-col">
                            <span className="font-bold text-foreground group-hover:text-primary transition-colors text-base truncate max-w-[200px]">
                            {fixEncoding(p.name)}
                            </span>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-muted-foreground font-mono">{p.region}</span>
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-normal bg-muted text-muted-foreground border-border">
                                    {p.tier}
                                </Badge>
                            </div>
                        </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center">
                        <span className="font-black text-foreground text-lg tracking-tight">{p.rating}</span>
                        <span className="text-[10px] text-muted-foreground uppercase font-bold">Peak: {p.peakRating || '---'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className={`font-bold ${winrate >= 60 ? 'text-green-500' : winrate >= 50 ? 'text-primary' : 'text-muted-foreground'}`}>
                        {winrate.toFixed(1)}%
                    </div>
                  </TableCell>
                  <TableCell className="text-center hidden sm:table-cell text-muted-foreground font-mono">
                    {p.wins}
                  </TableCell>
                  <TableCell className="text-center hidden sm:table-cell text-muted-foreground font-mono">
                    {p.games}
                  </TableCell>
                </TableRow>
              )})
            ) : (
              // Empty State
              <TableRow className="border-border hover:bg-transparent">
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  No players found for this region.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="p-4 border-t border-border flex justify-between items-center bg-muted/20">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 1 || isLoading}
          onClick={() => setPage(p => Math.max(1, p - 1))}
        >
          ← Prev
        </Button>
        <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-mono">Page</span>
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
            <span className="text-sm text-muted-foreground font-mono">of {totalPages || '?'}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || isLoading}
          onClick={() => setPage(p => p + 1)}
        >
          Next →
        </Button>
      </div>
    </Card>
  );
}
