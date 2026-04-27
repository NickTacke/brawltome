'use client'

import { type PlayerLinkInfo, linkSteam, unlinkPlayer } from '@/lib/auth'
import { useQueryClient } from '@tanstack/react-query'
import { Gamepad2, Loader2 } from 'lucide-react'
import { useState } from 'react'

interface BrawlhallaLinkRowProps {
  link: PlayerLinkInfo | null
}

export function BrawlhallaLinkRow({ link }: BrawlhallaLinkRowProps) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)

  const handleRelink = async () => {
    if (pending) return
    setPending(true)
    try {
      await unlinkPlayer(queryClient)
      await linkSteam()
    } finally {
      setPending(false)
    }
  }

  if (!link) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-white/[0.06] p-2">
            <Gamepad2 className="text-muted-foreground h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">Brawlhalla</p>
            <p className="text-muted-foreground text-xs">Link via Steam to connect your player profile</p>
          </div>
        </div>
        <button
          type="button"
          onClick={linkSteam}
          className="cursor-pointer rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/[0.1]"
        >
          Link Steam
        </button>
      </div>
    )
  }

  if (link.status === 'pending') {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-white/[0.06] p-2">
            <Gamepad2 className="text-muted-foreground h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">Brawlhalla</p>
            <p className="text-muted-foreground text-xs">Looking up your player profile...</p>
          </div>
        </div>
        <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
      </div>
    )
  }

  if (link.status === 'failed') {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-red-500/10 p-2">
            <Gamepad2 className="h-4 w-4 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-red-400">Brawlhalla</p>
            <p className="text-xs text-red-400/70">No Brawlhalla account found for this Steam ID</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRelink}
          disabled={pending}
          className="cursor-pointer rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (link.status === 'conflict') {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2">
            <Gamepad2 className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-400">Brawlhalla</p>
            <p className="text-xs text-amber-400/70">This player is already linked to another account</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRelink}
          disabled={pending}
          className="cursor-pointer rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-emerald-500/10 p-2">
          <Gamepad2 className="h-4 w-4 text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-emerald-400">Brawlhalla</p>
          <p className="text-xs text-emerald-400/70">ID: {link.brawlhallaId}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => unlinkPlayer(queryClient)}
        className="text-muted-foreground hover:text-foreground cursor-pointer text-xs underline-offset-4 transition-colors hover:underline"
      >
        Unlink
      </button>
    </div>
  )
}
