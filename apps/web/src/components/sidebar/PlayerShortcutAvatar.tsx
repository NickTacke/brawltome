'use client'

import { User } from '@solar-icons/react'

export function PlayerShortcutAvatar({ avatarUrl, className }: { avatarUrl: string | null; className: string }) {
  return (
    <span
      className={`bg-sidebar-accent relative flex shrink-0 items-center justify-center overflow-hidden ${className}`}
    >
      <User className="h-3/5 w-3/5" weight="Linear" aria-hidden="true" />
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={({ currentTarget }) => currentTarget.remove()}
        />
      )}
    </span>
  )
}
