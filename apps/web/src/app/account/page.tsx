'use client'

import { Skeleton } from '@/components/ui'
import { signIn, useAccount } from '@/lib/auth'
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

function LoadingState() {
  return (
    <main className="mx-auto min-h-[60vh] max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <Skeleton className="h-[30rem] rounded-xl" />
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      </div>
    </main>
  )
}

function SignedOutState({ error }: { error: string | null }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-6 py-12">
      <div className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center sm:p-8">
        {error && ERROR_MESSAGES[error] && (
          <div
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
            role="alert"
          >
            {ERROR_MESSAGES[error]}
          </div>
        )}

        <Image src="/images/logo.png" alt="BrawlTome" width={240} height={240} className="mx-auto w-36" />
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Sign in to BrawlTome</h1>
        <p className="text-muted-foreground mt-2 text-sm">Use Discord to continue to your account dashboard.</p>

        <button
          type="button"
          onClick={signIn}
          className="mt-8 inline-flex cursor-pointer items-center gap-2.5 rounded-xl bg-[#5865F2] px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#4752C4] active:scale-[0.98]"
        >
          <DiscordIcon className="h-5 w-5" />
          Continue with Discord
        </button>
      </div>
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
