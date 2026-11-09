import type { ThemeColours } from './theme-palettes'

const minimumAccentContrast = 3
// the site's hovers and stripes are built for dark pages
const brightestPageLuminance = 0.18

function channelLuminance(value: number): number {
  const channel = value / 255

  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const red = channelLuminance(Number.parseInt(hex.slice(1, 3), 16))
  const green = channelLuminance(Number.parseInt(hex.slice(3, 5), 16))
  const blue = channelLuminance(Number.parseInt(hex.slice(5, 7), 16))

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(first: string, second: string): number {
  const lighter = Math.max(luminance(first), luminance(second))
  const darker = Math.min(luminance(first), luminance(second))

  return (lighter + 0.05) / (darker + 0.05)
}

/** What's wrong with a made theme, for colour picker values in #rrggbb form. */
export function themeWarning({ page, accent }: ThemeColours): string | null {
  if (luminance(page) > brightestPageLuminance) {
    return "Light backgrounds aren't supported yet, parts of the site will look wrong."
  }

  if (contrast(page, accent) < minimumAccentContrast) return 'Links and highlights are hard to see on this background.'

  return null
}
