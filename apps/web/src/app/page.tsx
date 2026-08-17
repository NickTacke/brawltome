'use client'

import { Leaderboard } from '@/components/Leaderboard'
import { SearchBar } from '@/components/SearchBar'
import { Skeleton } from '@/components/ui'
import Image from 'next/image'
import Link from 'next/link'
import { Suspense, useState } from 'react'

export default function Home() {
  const [isSearchFocused, setIsSearchFocused] = useState(false)

  return (
    <main className="min-h-screen flex flex-col items-center p-4 relative">
      <div className="w-full max-w-4xl pt-2 pb-6 sm:pt-6 flex flex-col items-center text-center transition-all duration-300 relative z-50">
        <div className={`mb-6 transition-all duration-300 ${isSearchFocused ? 'blur-xs opacity-50' : ''}`}>
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
          onBlur={() => setTimeout(() => setIsSearchFocused(false), 100)}
        />
      </div>

      <div
        className={`w-full pb-12 transition-all duration-300 ${isSearchFocused ? 'blur-xs opacity-50 pointer-events-none' : ''}`}
      >
        <Suspense
          fallback={
            <div className="w-full space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
          }
        >
          <Leaderboard />
        </Suspense>
      </div>

      <footer className="w-full max-w-3xl mx-auto px-4 pb-8 mt-12">
        <div className="border-t border-border pt-6">
          <p className="text-center text-xs text-muted-foreground leading-relaxed">
            Visual assets courtesy of{' '}
            <Link
              href="https://www.bluemammoth.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors underline"
            >
              Blue Mammoth Games
            </Link>
            .
            <br />
            BrawlTome is neither associated nor endorsed by Blue Mammoth Games and doesn&apos;t reflect the views or
            opinions of Blue Mammoth Games or anyone officially involved in developing Brawlhalla.
            <br />
            Brawlhalla and Blue Mammoth Games are trademarks of{' '}
            <Link
              href="https://www.bluemammoth.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors underline"
            >
              Blue Mammoth Games
            </Link>
            .
          </p>
        </div>
      </footer>
    </main>
  )
}
