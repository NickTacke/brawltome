'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';

export function ServerStatus() {
  const { data, error } = useSWR('/status', fetcher, {
    refreshInterval: 10000, // Check every 10s
  });

  if (error) return (
    <div className="text-red-500 text-xs font-mono">
      Server Offline
    </div>
  );

  if (!data) return (
    <div className="animate-pulse flex items-center gap-2">
      <div className="w-2 h-2 bg-slate-500 rounded-full"></div>
      <span className="text-xs text-slate-500 font-mono">Connecting...</span>
    </div>
  );

  const { tokens } = data;
  let statusColor = 'bg-green-500';
  let statusText = 'Operational';
  
  if (tokens < 20) {
    statusColor = 'bg-red-500';
    statusText = 'High Load (Paused)';
  } else if (tokens < 100) {
    statusColor = 'bg-yellow-500';
    statusText = 'Busy';
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-slate-900/50 rounded-full border border-slate-800">
      <div className="relative flex h-2 w-2">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusColor}`}></span>
        <span className={`relative inline-flex rounded-full h-2 w-2 ${statusColor}`}></span>
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">{statusText}</span>
        <span className="text-[10px] font-mono text-slate-500">API Budget: {tokens}/180</span>
      </div>
    </div>
  );
}

