export type ThemeColours = { page: string; accent: string }
export type ThemeTokens = {
  ink: string
  rail: string
  raised: string
  line: string
  text: string
  strong: string
  soft: string
  primary: string
  primaryInk: string
}
export type ThemePreset = { id: string; label: string; tokens: ThemeTokens }

export const defaultThemeId = 'slate'

const slateTokens: ThemeTokens = {
  ink: 'hsl(224 19.5% 13.5%)',
  rail: 'hsl(226.15 19.4% 13.14%)',
  raised: 'hsl(222 19.61% 21%)',
  line: 'hsl(221.54 20.31% 25.1%)',
  text: 'hsl(210 22% 86%)',
  strong: 'hsl(207 26% 95%)',
  soft: 'hsl(213.33 16% 68%)',
  primary: 'hsl(212 92% 65%)',
  primaryInk: 'hsl(224 30% 12%)',
}

// midnight, poimandres, carbon and vesper use the colours of the editor themes of those names
export const themePresets: ThemePreset[] = [
  { id: 'slate', label: 'Slate', tokens: slateTokens },
  {
    id: 'midnight',
    label: 'Midnight',
    tokens: {
      ink: '#1a1b26',
      rail: '#16161e',
      raised: '#24283b',
      line: '#2f3549',
      text: '#a9b1d6',
      strong: '#c0caf5',
      soft: '#787c99',
      primary: '#7aa2f7',
      primaryInk: '#16161e',
    },
  },
  {
    id: 'poimandres',
    label: 'Poimandres',
    tokens: {
      ink: '#1b1e28',
      rail: '#171922',
      raised: '#252b37',
      line: '#303340',
      text: '#a6accd',
      strong: '#e4f0fb',
      soft: '#767c9d',
      primary: '#5de4c7',
      primaryInk: '#1b1e28',
    },
  },
  {
    id: 'amethyst',
    label: 'Amethyst',
    tokens: {
      ink: '#1c1926',
      rail: '#18161f',
      raised: '#28243a',
      line: '#312c45',
      text: '#d9d4e8',
      strong: '#f3f0fb',
      soft: '#9a93b3',
      primary: '#c39bff',
      primaryInk: '#18161f',
    },
  },
  {
    id: 'carbon',
    label: 'Carbon',
    tokens: {
      ink: '#161616',
      rail: '#0f0f0f',
      raised: '#262626',
      line: '#2a2a2a',
      text: '#dfdfe0',
      strong: '#f2f4f8',
      soft: '#8d8d8d',
      primary: '#78a9ff',
      primaryInk: '#161616',
    },
  },
  {
    id: 'vesper',
    label: 'Vesper',
    tokens: {
      ink: '#101010',
      rail: '#0b0b0b',
      raised: '#1c1c1c',
      line: '#282828',
      text: '#d4d4d4',
      strong: '#ffffff',
      soft: '#8b8b8b',
      primary: '#ffc799',
      primaryInk: '#101010',
    },
  },
]

// the same lightness steps slate takes from its page, so a made theme keeps the calm sidebar and borders
export function tokensFromColours({ page, accent }: ThemeColours): ThemeTokens {
  return {
    ink: page,
    rail: `oklch(from ${page} calc(l - 0.0048) c h)`,
    raised: `oklch(from ${page} calc(l + 0.0736) c h)`,
    line: `oklch(from ${page} calc(l + 0.1113) c h)`,
    text: `oklch(from ${page} 0.8887 0.0137 h)`,
    strong: `oklch(from ${page} 0.961 0.0056 h)`,
    soft: `oklch(from ${page} 0.7398 0.0247 h)`,
    primary: accent,
    primaryInk: `oklch(from ${page} 0.221 0.0275 h)`,
  }
}

export function themeVariables(tokens: ThemeTokens): Record<string, string> {
  return {
    '--color-ink': tokens.ink,
    '--color-rail': tokens.rail,
    '--color-raised': tokens.raised,
    '--color-line': tokens.line,
    '--color-text': tokens.text,
    '--color-strong': tokens.strong,
    '--color-soft': tokens.soft,
    '--color-primary': tokens.primary,
    '--color-primary-ink': tokens.primaryInk,
  }
}
