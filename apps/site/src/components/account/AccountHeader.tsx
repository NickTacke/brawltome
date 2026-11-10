import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { formatDay } from '../../lib'
import { signOutAccount } from '../../server/account'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { railAccount } from '../rail/use-rail-account'
import { socialLinks } from '../social-links'
import type { SignedInAccount } from './account-model'

const discordIcon = socialLinks.find((link) => link.label === 'Discord')?.svg

function useSignOut() {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [hasFailed, setHasFailed] = useState(false)

  async function signOut() {
    setIsSigningOut(true)
    setHasFailed(false)

    const answer = await signOutAccount().catch(() => ({ kind: 'failed' }) as const)

    setIsSigningOut(false)

    if (answer.kind === 'failed') {
      setHasFailed(true)

      return
    }

    railAccount.showSignedOut()
    await router.invalidate()
  }

  return { signOut, isSigningOut, hasFailed }
}

export function AccountHeader({ account }: { account: SignedInAccount }) {
  const { signOut, isSigningOut, hasFailed } = useSignOut()

  return (
    <header className="flex items-center gap-4 border-b border-line/50 pb-6">
      <img
        src={account.avatarUrl ?? legendAvatarUrl(null)}
        alt=""
        className="size-20 shrink-0 rounded-full bg-raised object-cover object-top"
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-4xl font-black tracking-tight text-strong">{account.displayName}</h1>
        <div className="mt-1 flex items-center gap-1.5 text-sm text-soft [&_svg]:size-4">
          {discordIcon} Connected · Member since {formatDay(account.createdAt)}
        </div>
        {hasFailed && (
          <p role="alert" className="mt-1 text-sm font-medium text-red-400">
            Couldn't sign you out. Please try again.
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={isSigningOut}
        onClick={() => void signOut()}
        className="shrink-0 text-sm font-semibold text-soft transition-colors hover:text-strong disabled:opacity-50"
      >
        Sign out
      </button>
    </header>
  )
}
