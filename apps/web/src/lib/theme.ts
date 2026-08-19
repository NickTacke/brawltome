import type { AccountPreferencesContract } from '@brawltome/contracts'

export type AccountTheme = AccountPreferencesContract['theme']

export const ACCOUNT_THEME_OPTIONS = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'purple', label: 'Purple' },
] as const satisfies ReadonlyArray<{ value: AccountTheme; label: string }>

export function applyAccountTheme(theme: AccountTheme): void {
  const root = document.documentElement
  if (theme === 'neutral') {
    root.removeAttribute('data-theme')
    return
  }
  root.dataset.theme = theme
}
