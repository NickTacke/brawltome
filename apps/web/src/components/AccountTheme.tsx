'use client'

import { useAccount, useAccountPreferences } from '@/lib/auth'
import { type AccountTheme as AccountThemeValue, applyAccountTheme } from '@/lib/theme'
import { useEffect } from 'react'

type AccountThemeState = {
  account: { id: string } | null
  accountLoading: boolean
  accountError: boolean
  preferences: { theme: AccountThemeValue } | null
  preferencesLoading: boolean
  preferencesError: boolean
}

export function resolveAccountTheme({
  account,
  accountLoading,
  accountError,
  preferences,
  preferencesLoading,
  preferencesError,
}: AccountThemeState): AccountThemeValue | null {
  if (accountLoading || accountError || preferencesLoading || preferencesError) return null
  return account ? (preferences?.theme ?? 'neutral') : 'neutral'
}

export function AccountTheme() {
  const { account, isLoading: accountLoading, isError: accountError } = useAccount()
  const {
    preferences,
    isLoading: preferencesLoading,
    isError: preferencesError,
  } = useAccountPreferences(accountLoading ? undefined : (account?.id ?? null))

  const theme = resolveAccountTheme({
    account,
    accountLoading,
    accountError,
    preferences,
    preferencesLoading,
    preferencesError,
  })

  useEffect(() => {
    if (theme !== null) applyAccountTheme(theme)
  }, [theme])

  return null
}
