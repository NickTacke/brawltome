'use client'

import { useAccount, useAccountPreferences } from '@/lib/auth'
import { applyAccountTheme } from '@/lib/theme'
import { useEffect } from 'react'

export function AccountTheme() {
  const { account, isLoading: accountLoading, isError: accountError } = useAccount()
  const {
    preferences,
    isLoading: preferencesLoading,
    isError: preferencesError,
  } = useAccountPreferences(accountLoading ? undefined : (account?.id ?? null))

  useEffect(() => {
    if (accountLoading || accountError || preferencesLoading || preferencesError) return
    applyAccountTheme(account ? (preferences?.theme ?? 'neutral') : 'neutral')
  }, [account, accountError, accountLoading, preferences?.theme, preferencesError, preferencesLoading])

  return null
}
