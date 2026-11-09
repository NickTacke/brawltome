import { useEffect, useState } from 'react'
import {
  defaultThemeId,
  type ThemeColours,
  type ThemeTokens,
  themeVariables,
  tokensFromColours,
} from './theme-palettes'
import {
  activeThemeStorageKey,
  applyVariables,
  readActiveTheme,
  readSavedThemes,
  type SavedTheme,
  savedThemesStorageKey,
} from './theme-storage'

// a new theme starts from slate, so people adjust the site's look rather than someone else's
const startingColours: ThemeColours = { page: '#1c1f29', accent: '#54a0f8' }

function storedActiveVariables(): Record<string, string> | null {
  const savedThemes = readSavedThemes(localStorage.getItem(savedThemesStorageKey))

  return readActiveTheme(localStorage.getItem(activeThemeStorageKey), savedThemes)?.variables ?? null
}

export function useThemes() {
  const [activeId, setActiveId] = useState(defaultThemeId)
  const [savedThemes, setSavedThemes] = useState<SavedTheme[]>([])

  // storage only exists in the browser, so the first render shows the default like the server did
  useEffect(() => {
    const saved = readSavedThemes(localStorage.getItem(savedThemesStorageKey))
    const active = readActiveTheme(localStorage.getItem(activeThemeStorageKey), saved)

    setSavedThemes(saved)

    if (active) setActiveId(active.id)
  }, [])

  function activate(id: string, tokens: ThemeTokens) {
    setActiveId(id)

    if (id === defaultThemeId) {
      applyVariables(null)
      localStorage.removeItem(activeThemeStorageKey)

      return
    }

    const variables = themeVariables(tokens)

    applyVariables(variables)
    localStorage.setItem(activeThemeStorageKey, JSON.stringify({ id, variables }))
  }

  function storeSaved(themes: SavedTheme[]) {
    setSavedThemes(themes)
    localStorage.setItem(savedThemesStorageKey, JSON.stringify(themes))
  }

  function createTheme() {
    const theme = { id: crypto.randomUUID(), name: `Theme ${savedThemes.length + 1}`, colours: startingColours }

    storeSaved([...savedThemes, theme])
    activate(theme.id, tokensFromColours(theme.colours))
  }

  function updateTheme(next: SavedTheme) {
    storeSaved(savedThemes.map((theme) => (theme.id === next.id ? next : theme)))
    activate(next.id, tokensFromColours(next.colours))
  }

  function deleteTheme(id: string, defaultTokens: ThemeTokens) {
    storeSaved(savedThemes.filter((theme) => theme.id !== id))
    activate(defaultThemeId, defaultTokens)
  }

  return { activeId, savedThemes, activate, createTheme, updateTheme, deleteTheme }
}

function restoreActiveTheme() {
  applyVariables(storedActiveVariables())
}

function previewTheme(tokens: ThemeTokens) {
  applyVariables(themeVariables(tokens))
}

// hovering shows the whole page in a theme, and leaving puts the chosen one back, also when the picker closes mid hover
export function usePreview() {
  useEffect(() => restoreActiveTheme, [])

  return { preview: previewTheme, endPreview: restoreActiveTheme }
}
