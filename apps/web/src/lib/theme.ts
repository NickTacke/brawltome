import type { AccountPreferencesContract } from '@brawltome/contracts'

export const ACCOUNT_THEME_COOKIE = 'brawltome-theme'
const ACCOUNT_THEME_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export type AccountTheme = AccountPreferencesContract['theme']

export const ACCOUNT_THEME_OPTIONS = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'purple', label: 'Purple' },
] as const satisfies ReadonlyArray<{ value: AccountTheme; label: string }>

export async function resolveInitialAccountTheme(
  cookieTheme: string | undefined,
  hasSession: boolean,
  loadPreferences: () => Promise<Pick<AccountPreferencesContract, 'theme'>>,
): Promise<AccountTheme | undefined> {
  if (cookieTheme === 'purple') return 'purple'
  if (!hasSession) return undefined
  try {
    return (await loadPreferences()).theme === 'purple' ? 'purple' : undefined
  } catch {
    return undefined
  }
}

export function applyAccountTheme(theme: AccountTheme): void {
  const root = document.documentElement
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${ACCOUNT_THEME_COOKIE}=${theme}; Path=/; Max-Age=${theme === 'neutral' ? 0 : ACCOUNT_THEME_COOKIE_MAX_AGE}; SameSite=Lax${secure}`
  if (theme === 'neutral') {
    root.removeAttribute('data-theme')
    return
  }
  root.dataset.theme = theme
}
