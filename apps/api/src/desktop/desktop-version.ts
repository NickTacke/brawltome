import { desktopVersionSchema } from '@brawltome/contracts'

export type DesktopVersion = { major: number; minor: number; patch: number }

const noMinimumVersion: DesktopVersion = { major: 0, minor: 0, patch: 0 }

// a pre-release counts as its release: 0.2.0-beta.1 is 0.2.0
export function parseDesktopVersion(value: string | null | undefined): DesktopVersion | null {
  const checked = desktopVersionSchema.safeParse(value)

  if (!checked.success) return null

  const [release = ''] = checked.data.split('-')
  const [major, minor, patch] = release.split('.').map(Number)

  if (major === undefined || minor === undefined || patch === undefined) return null

  return { major, minor, patch }
}

export function isOlderDesktopVersion(version: DesktopVersion, minimum: DesktopVersion): boolean {
  if (version.major !== minimum.major) return version.major < minimum.major

  if (version.minor !== minimum.minor) return version.minor < minimum.minor

  return version.patch < minimum.patch
}

export function formatDesktopVersion(version: DesktopVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

// unset refuses no app; a value that does not parse stops the server from starting
export function readMinimumDesktopVersion(value: string | undefined): DesktopVersion {
  if (value === undefined) return noMinimumVersion

  const minimum = parseDesktopVersion(value)

  if (!minimum) throw new Error('DESKTOP_MINIMUM_VERSION must look like 0.2.0')

  return minimum
}
