'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ModeToggle } from '@/components/mode-toggle';
import { SearchBar } from '@/components/SearchBar';
import { ServerStatus } from '@/components/ServerStatus';
import { Leaderboard } from '@/components/Leaderboard';

export default function Home() {
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  return (
    <main className="min-h-screen flex flex-col items-center p-4 relative">
      <div className="absolute top-4 right-4 z-[100]">
        <ModeToggle />
      </div>
      <div className={`w-full max-w-4xl pt-6 pb-6 flex flex-col items-center text-center transition-all duration-300 relative z-50`}>
        <div className={`mb-6 transition-all duration-300 ${isSearchFocused ? 'blur-sm opacity-50' : ''}`}>
          <Image
            src="/images/logo.png"
            alt="BrawlTome Logo"
            width={400}
            height={100}
            priority
            className="h-auto w-auto max-w-[80vw] md:max-w-md"
          />
        </div>
        <SearchBar 
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => {
                // Small delay to prevent flickering if just clicking nearby or if needed for UI feel
                setTimeout(() => setIsSearchFocused(false), 100);
            }}
        />
      </div>

      <div className={`w-full pb-12 transition-all duration-300 ${isSearchFocused ? 'blur-sm opacity-50 pointer-events-none' : ''}`}>
        <Leaderboard />
      </div>
      
      <div className="fixed bottom-4 right-4 z-50">
        <ServerStatus />
      </div>
    </main>
  );
}