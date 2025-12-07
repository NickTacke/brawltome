'use client';

import { useState } from 'react';
import { SearchBar } from '@/components/SearchBar';
import { ServerStatus } from '@/components/ServerStatus';
import { Leaderboard } from '@/components/Leaderboard';

export default function Home() {
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  return (
    <main className="min-h-screen bg-slate-950 flex flex-col items-center p-4 relative">
      <div className={`w-full max-w-4xl pt-20 pb-12 flex flex-col items-center text-center transition-all duration-300 relative z-50`}>
        <h1 className={`text-6xl font-black text-white mb-8 tracking-tighter transition-all duration-300 ${isSearchFocused ? 'blur-sm opacity-50' : ''}`}>
          brawltome.app
        </h1>
        <SearchBar 
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => {
                // Small delay to prevent flickering if just clicking nearby or if needed for UI feel
                setTimeout(() => setIsSearchFocused(false), 100);
            }}
        />
      </div>

      <div className={`w-full pb-20 transition-all duration-300 ${isSearchFocused ? 'blur-sm opacity-50 pointer-events-none' : ''}`}>
        <Leaderboard />
      </div>
      
      <div className="fixed bottom-4 right-4 z-50">
        <ServerStatus />
      </div>
    </main>
  );
}