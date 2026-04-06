'use client'

import { useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { useMe, signIn, signOut } from '@/lib/auth'

const ERROR_MESSAGES: Record<string, string> = {
  state: 'Your sign-in attempt expired or was interrupted. Please try again.',
  discord: "We couldn't finish signing you in with Discord. Please try again in a moment.",
  server: 'Something went wrong on our end. Please try again.',
}

export default function AccountPage() {
  const { user, isLoading } = useMe()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const queryClient = useQueryClient()

  if (isLoading) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-6">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 px-6">
        {error && ERROR_MESSAGES[error] && (
          <div className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {ERROR_MESSAGES[error]}
          </div>
        )}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Sign in to BrawlTome</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Accounts are optional. Sign in to unlock follows, activity feed, and tournament features as they
            ship.
          </p>
        </div>
        <button
          type="button"
          onClick={signIn}
          className="inline-flex items-center justify-center rounded-xl bg-[#5865F2] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#4752C4]"
        >
          Sign in with Discord
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-4">
        {user.avatarUrl ? (
          <Image
            src={user.avatarUrl}
            alt=""
            width={96}
            height={96}
            className="h-24 w-24 rounded-full object-cover"
            unoptimized
          />
        ) : (
          <div className="bg-muted h-24 w-24 rounded-full" />
        )}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">{user.username}</h1>
          <p className="text-muted-foreground mt-1 text-xs">Signed in via Discord</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => signOut(queryClient)}
        className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
      >
        Sign out
      </button>
    </main>
  )
}
