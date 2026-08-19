'use client'

import { useAccount, useAccountPreferences } from '@/lib/auth'
import { applyAccountTheme } from '@/lib/theme'
import { useEffect } from 'react'

export function AccountTheme() {
  const { account } = useAccount()
  const { preferences } = useAccountPreferences(account?.id)
  const theme = account ? (preferences?.theme ?? 'neutral') : 'neutral'

  useEffect(() => {
    applyAccountTheme(theme)
  }, [theme])

  return null
}
