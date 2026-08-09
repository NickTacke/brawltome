'use client'

import { signOut, usePlayerLink } from '@/lib/auth'
import type { AccountContract } from '@brawltome/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { Link2, Users } from 'lucide-react'
import { BrawlhallaLinkRow } from './BrawlhallaLinkRow'
import { DiscordIcon } from './DiscordIcon'

interface SignedInStateProps {
  account: AccountContract
}

export function SignedInState({ account }: SignedInStateProps) {
  const queryClient = useQueryClient()
  const { playerLink, isLoading: playerLinkLoading } = usePlayerLink()
  const memberSince = new Date(account.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col gap-6 px-6 py-12">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
        <div className="flex items-center gap-4">
          {account.avatarUrl ? (
            <img
              src={account.avatarUrl}
              alt=""
              className="h-16 w-16 rounded-full object-cover ring-2 ring-white/[0.08]"
            />
          ) : (
            <div className="bg-muted flex h-16 w-16 items-center justify-center rounded-full ring-2 ring-white/[0.08]">
              <Users className="text-muted-foreground h-7 w-7" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">{account.displayName}</h1>
            <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
              <DiscordIcon className="h-3.5 w-3.5" />
              <span>Connected via Discord</span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">Member since {memberSince}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
        <h2 className="text-sm font-semibold">Linked Accounts</h2>
        <div className="mt-4 space-y-3">
          <BrawlhallaLinkRow link={playerLink} loading={playerLinkLoading} />
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
