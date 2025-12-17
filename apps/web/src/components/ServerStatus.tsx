'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Skeleton } from '@brawltome/ui';

export function ServerStatus() {
  const { data, error } = useSWR('/status', fetcher, {
    refreshInterval: 10000, // Check every 10s
  });

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-destructive/50 bg-destructive/10 backdrop-blur-xs shadow-xs">
        <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
        <span className="text-xs font-medium text-destructive">Offline</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card/80 backdrop-blur-xs shadow-xs">
        <Skeleton className="h-2 w-2 rounded-full" />
        <Skeleton className="h-3 w-16" />
      </div>
    );
  }

  const { tokens } = data;
  let statusColor = 'bg-emerald-500';
  let statusText = 'Operational';

  if (tokens < 20) {
    statusColor = 'bg-destructive';
    statusText = 'High Load';
  } else if (tokens < 100) {
    statusColor = 'bg-yellow-500';
    statusText = 'Busy';
  }

  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full border border-border bg-card/80 backdrop-blur-xs shadow-xs hover:bg-card/90 transition-colors">
      <div className="relative flex h-2 w-2">
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusColor}`}
        ></span>
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${statusColor}`}
        ></span>
      </div>
      <span className="text-xs font-medium text-muted-foreground">
        {statusText}
      </span>
    </div>
  );
}
