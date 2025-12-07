'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { fetcher } from '@/lib/api';
import { fixEncoding } from '@/lib/utils';

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

export function Leaderboard() {
  const [page, setPage] = useState(1);
  const [region, setRegion] = useState('all');
  const router = useRouter();

  const { data, isLoading } = useSWR(
    `/player/leaderboard/${page}?region=${region}&limit=20`,
    fetcher
  );

  const players = data?.data || [];
  const totalPages = data?.meta?.totalPages || 1;

  const handleRegionChange = (newRegion: string) => {
    setRegion(newRegion);
    setPage(1); // Reset to page 1 on filter change
  };

  return (
    <div className="w-full max-w-4xl mx-auto mt-12 bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-4">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <span className="text-yellow-500">🏆</span> Leaderboard
        </h2>
        
        {/* Region Filter */}
        <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400 font-bold uppercase">Region:</span>
            <select
                value={region}
                onChange={(e) => handleRegionChange(e.target.value)}
                className="bg-slate-800 text-white text-sm font-bold py-2 px-4 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-slate-700 transition-colors"
            >
                {REGIONS.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                ))}
            </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase font-bold tracking-wider">
            <tr>
              <th className="p-4 w-16 text-center">Rank</th>
              <th className="p-4">Player</th>
              <th className="p-4 text-center">Rating / Peak</th>
              <th className="p-4 text-center hidden sm:table-cell">Wins</th>
              <th className="p-4 text-center hidden sm:table-cell">Games</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {isLoading ? (
              // Skeleton Loading State
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="p-4"><div className="h-4 w-8 bg-slate-800 rounded mx-auto" /></td>
                  <td className="p-4"><div className="h-4 w-32 bg-slate-800 rounded" /></td>
                  <td className="p-4"><div className="h-4 w-12 bg-slate-800 rounded mx-auto" /></td>
                  <td className="p-4 hidden sm:table-cell"><div className="h-4 w-12 bg-slate-800 rounded mx-auto" /></td>
                  <td className="p-4 hidden sm:table-cell"><div className="h-4 w-12 bg-slate-800 rounded mx-auto" /></td>
                </tr>
              ))
            ) : players.length > 0 ? (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              players.map((p: any, i: number) => (
                <tr 
                  key={p.brawlhallaId}
                  onClick={() => router.push(`/player/${p.brawlhallaId}`)}
                  className="hover:bg-slate-800/50 cursor-pointer transition-colors group"
                >
                  <td className="p-4 text-center font-mono text-slate-500 group-hover:text-white">
                    #{((page - 1) * 20) + i + 1}
                  </td>
                  <td className="p-4">
                    <div className="font-bold text-slate-200 group-hover:text-blue-400 transition-colors">
                      {fixEncoding(p.name)}
                    </div>
                    <div className="text-xs text-slate-500">{p.region} • {p.tier}</div>
                  </td>
                  <td className="p-4 text-center">
                    <div className="font-bold text-white text-lg">
                        <span className="text-yellow-500">{p.rating}</span>
                        <span className="text-slate-600 mx-1">/</span>
                        <span className="text-slate-400 text-sm">{p.peakRating || '---'}</span>
                    </div>
                  </td>
                  <td className="p-4 text-center hidden sm:table-cell text-slate-400">
                    {p.wins}
                  </td>
                  <td className="p-4 text-center hidden sm:table-cell text-slate-400">
                    {p.games}
                  </td>
                </tr>
              ))
            ) : (
              // Empty State
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-500">
                  No players found for this region.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="p-4 border-t border-slate-800 flex justify-between items-center bg-slate-900/50">
        <button
          disabled={page === 1 || isLoading}
          onClick={() => setPage(p => Math.max(1, p - 1))}
          className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-50 hover:bg-slate-700 transition-colors text-sm font-bold"
        >
          ← Prev
        </button>
        <span className="text-sm text-slate-500 font-mono">
          Page {page} of {totalPages || '?'}
        </span>
        <button
          disabled={page >= totalPages || isLoading}
          onClick={() => setPage(p => p + 1)}
          className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-50 hover:bg-slate-700 transition-colors text-sm font-bold"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

