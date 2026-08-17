'use client'

import { Skeleton } from '@/components/ui'
import { signIn, useAccount } from '@/lib/auth'
import { Bookmark, Monitor, Trophy, UserRound } from 'lucide-react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { DiscordIcon } from './DiscordIcon'
import { SignedInState } from './SignedInState'

const ERROR_MESSAGES: Record<string, string> = {
  state: 'Your sign-in attempt expired or was interrupted. Please try again.',
  discord: "We couldn't finish signing you in with Discord. Please try again in a moment.",
  server: 'Something went wrong on our end. Please try again.',
  auth: 'You need to be signed in to link accounts.',
  steam: "We couldn't verify your Steam account. Please try again.",
  already_linked: 'You already have a linked player. Unlink first.',
}

const FEATURE_TEASERS = [
  {
    icon: Bookmark,
    title: 'Saved Players',
    description: 'Keep private player bookmarks with honestly scoped latest observations.',
  },
  {
    icon: Monitor,
    title: 'Desktop App',
    description: 'Real-time overlay and match tracking. Requires an account.',
  },
  {
    icon: UserRound,
    title: 'Player Profiles',
    description: 'Return to canonical Current Season and Career facts without ownership claims.',
  },
  {
    icon: Trophy,
    title: 'Tournaments',
    description: 'Compete in brackets and track results across seasons.',
  },
]

function LoadingState() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center px-6">
      <div className="flex w-full flex-col items-center gap-6">
        <Skeleton className="h-20 w-20 rounded-full" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
    </main>
  )
}

function SignedOutState({ error }: { error: string | null }) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center pb-12">
      {error && ERROR_MESSAGES[error] && (
        <div className="mb-8 w-full rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
          {ERROR_MESSAGES[error]}
        </div>
      )}

      <Image src="/images/logo.png" alt="BrawlTome" width={400} height={400} className="w-64" />

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Sign in</h1>

      <div className="mt-10 w-full space-y-2">
        {FEATURE_TEASERS.map((feature) => (
          <div key={feature.title} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <feature.icon className="text-muted-foreground h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <span className="text-sm font-medium">{feature.title}</span>
              <span className="text-muted-foreground ml-2 text-xs">{feature.description}</span>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={signIn}
        className="mt-8 inline-flex cursor-pointer items-center gap-2.5 rounded-xl bg-[#5865F2] px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#4752C4] active:scale-[0.98]"
      >
        <DiscordIcon className="h-5 w-5" />
        Continue with Discord
      </button>
    </main>
  )
}

function AccountPageInner() {
  const { account, isLoading } = useAccount()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  if (isLoading) return <LoadingState />
  if (!account) return <SignedOutState error={error} />
  return <SignedInState account={account} />
}

export default function AccountPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AccountPageInner />
    </Suspense>
  )
}
