'use client'

import { useQueryClient } from '@tanstack/react-query'
import { Gamepad2, Link2, Monitor, Rss, Trophy, UserPlus, Users } from 'lucide-react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { type Me, signIn, signOut, useMe } from '@/lib/auth'
import { Skeleton } from '@brawltome/ui'

const ERROR_MESSAGES: Record<string, string> = {
  state: 'Your sign-in attempt expired or was interrupted. Please try again.',
  discord: "We couldn't finish signing you in with Discord. Please try again in a moment.",
  server: 'Something went wrong on our end. Please try again.',
}

const FEATURE_TEASERS = [
  {
    icon: UserPlus,
    title: 'Follow Players',
    description: 'Track your favorites and see live elo changes as they climb.',
  },
  {
    icon: Monitor,
    title: 'Desktop App',
    description: 'Real-time overlay and match tracking. Requires an account.',
  },
  {
    icon: Rss,
    title: 'Activity Feed',
    description: 'See when followed players rank up or hit new milestones.',
  },
  {
    icon: Trophy,
    title: 'Tournaments',
    description: 'Compete in brackets and track results across seasons.',
  },
]

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
    </svg>
  )
}

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

function SignedInState({ user }: { user: Me }) {
  const queryClient = useQueryClient()
  const memberSince = new Date(user.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col gap-6 px-6 py-12">
      {/* Profile */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            // biome-ignore lint/performance/noImgElement: external avatar host
            <img
              src={user.avatarUrl}
              alt=""
              className="h-16 w-16 rounded-full object-cover ring-2 ring-white/[0.08]"
            />
          ) : (
            <div className="bg-muted flex h-16 w-16 items-center justify-center rounded-full ring-2 ring-white/[0.08]">
              <Users className="text-muted-foreground h-7 w-7" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">{user.username}</h1>
            <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
              <DiscordIcon className="h-3.5 w-3.5" />
              <span>Connected via Discord</span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">Member since {memberSince}</p>
          </div>
        </div>
      </div>

      {/* Linked Accounts */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
        <h2 className="text-sm font-semibold">Linked Accounts</h2>
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-white/[0.06] p-2">
                <Gamepad2 className="text-muted-foreground h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Brawlhalla</p>
                <p className="text-muted-foreground text-xs">Link your player profile</p>
              </div>
            </div>
            <span className="text-muted-foreground rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
              Soon
            </span>
          </div>
          <div className="border-border/50 border-t" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-white/[0.06] p-2">
                <Link2 className="text-muted-foreground h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Socials</p>
                <p className="text-muted-foreground text-xs">Connect your social profiles</p>
              </div>
            </div>
            <span className="text-muted-foreground rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
              Soon
            </span>
          </div>
        </div>
      </div>

      {/* Following / Followers */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-lg font-bold">0</p>
            <p className="text-muted-foreground text-xs">Following</p>
          </div>
          <div className="border-border/50 h-8 border-l" />
          <div className="text-center">
            <p className="text-lg font-bold">0</p>
            <p className="text-muted-foreground text-xs">Followers</p>
          </div>
        </div>
        <p className="text-muted-foreground mt-4 text-xs">
          Follow players from their profile page to track their progress.
        </p>
      </div>

      {/* Sign out */}
      <button
        type="button"
        onClick={() => signOut(queryClient)}
        className="text-muted-foreground hover:text-foreground cursor-pointer self-center text-sm underline-offset-4 transition-colors hover:underline"
      >
        Sign out
      </button>
    </main>
  )
}

export default function AccountPage() {
  const { user, isLoading } = useMe()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  if (isLoading) return <LoadingState />
  if (!user) return <SignedOutState error={error} />
  return <SignedInState user={user} />
}
