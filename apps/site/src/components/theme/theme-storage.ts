import { type ThemeColours, themePresets, themeVariables } from './theme-palettes'

export type SavedTheme = { id: string; name: string; colours: ThemeColours }
export type ActiveTheme = { id: string; variables: Record<string, string> }

export const activeThemeStorageKey = 'brawltome-theme'
export const savedThemesStorageKey = 'brawltome-saved-themes'
export const maximumSavedThemes = 8

// runs in the head before the first paint, so a saved theme never flashes the default colours
export const themeBootScript = `try{var t=JSON.parse(localStorage.getItem('${activeThemeStorageKey}'));if(t&&t.variables)for(var k in t.variables)document.documentElement.style.setProperty(k,t.variables[k])}catch(e){}`

function parse(stored: string | null): unknown {
  if (!stored) return null

  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

function isSavedTheme(value: unknown): value is SavedTheme {
  const theme = value as SavedTheme | null

  return typeof theme?.id === 'string' && typeof theme.name === 'string' && typeof theme.colours?.page === 'string'
}

export function readSavedThemes(stored: string | null): SavedTheme[] {
  const value = parse(stored)

  return Array.isArray(value) ? value.filter(isSavedTheme) : []
}

/** The stored active theme, or null when it no longer exists, so a deleted or renamed theme falls back to the default. */
export function readActiveTheme(stored: string | null, savedThemes: SavedTheme[]): ActiveTheme | null {
  const active = parse(stored) as ActiveTheme | null

  if (typeof active?.id !== 'string') return null

  const isKnown = savedThemes.some(({ id }) => id === active.id) || themePresets.some(({ id }) => id === active.id)

  return isKnown ? active : null
}

// the meta tag needs a plain colour, so the page colour is painted once and read back as rgb
function resolvedPageColour(): string {
  const probe = document.createElement('span')

  probe.style.color = 'var(--color-ink)'
  document.body.append(probe)

  const colour = getComputedStyle(probe).color
  const context = document.createElement('canvas').getContext('2d')

  probe.remove()

  if (!context) return colour

  context.fillStyle = colour
  context.fillRect(0, 0, 1, 1)

  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data

  return `rgb(${red} ${green} ${blue})`
}

// the address bar on phones takes this colour, so it follows the page
export function syncBrowserColour() {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedPageColour())
}

export function applyVariables(variables: Record<string, string> | null) {
  const root = document.documentElement

  for (const name of Object.keys(themeVariables(themePresets[0].tokens))) root.style.removeProperty(name)

  for (const [name, value] of Object.entries(variables ?? {})) root.style.setProperty(name, value)

  syncBrowserColour()
}
