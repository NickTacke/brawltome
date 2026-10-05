'use client'

import { NavBar } from '@/components/NavBar'
import { LookupCard, type LookupCardProps } from './LookupCard'

export function LookupState(props: LookupCardProps) {
  return (
    <div>
      <NavBar showBack />
      <div className="flex justify-center py-16">
        <LookupCard {...props} />
      </div>
    </div>
  )
}
