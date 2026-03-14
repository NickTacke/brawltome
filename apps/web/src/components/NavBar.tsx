'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Home } from 'lucide-react'
import { Button } from '@brawltome/ui'
import { ModeToggle } from './mode-toggle'

interface NavBarProps {
  showBack?: boolean
}

export function NavBar({ showBack = false }: NavBarProps) {
  const router = useRouter()

  return (
    <div className="flex justify-between items-center">
      <div className="flex items-center gap-2">
        {showBack && (
          <Button variant="ghost" onClick={() => router.back()} className="text-sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        )}
        <Button variant="ghost" asChild className="text-sm">
          <Link href="/">
            <Home className="mr-2 h-4 w-4" />
            Home
          </Link>
        </Button>
      </div>
      <ModeToggle />
    </div>
  )
}
