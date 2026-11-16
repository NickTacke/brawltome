import { describe, expect, test } from 'bun:test'
import { desktopVersionHeader } from '@brawltome/contracts'
import { Hono } from 'hono'
import {
  type DesktopVersion,
  formatDesktopVersion,
  isOlderDesktopVersion,
  parseDesktopVersion,
  readMinimumDesktopVersion,
} from '../src/desktop/desktop-version'
import { type DesktopVariables, requireDesktopVersion } from '../src/desktop/require-desktop-version'

function version(text: string): DesktopVersion {
  const parsed = parseDesktopVersion(text)

  if (!parsed) throw new Error(`test version ${text} does not parse`)

  return parsed
}

function createApp(): Hono<{ Variables: DesktopVariables }> {
  const app = new Hono<{ Variables: DesktopVariables }>()

  app.use('*', requireDesktopVersion(version('0.2.0')))
  app.get('/', (context) => context.text(context.var.desktopVersion))

  return app
}

describe('desktop version', () => {
  test('reads major, minor and patch, and treats a pre-release as its release', () => {
    expect(parseDesktopVersion('0.2.0')).toEqual({ major: 0, minor: 2, patch: 0 })
    expect(parseDesktopVersion('0.2.0-beta.1')).toEqual({ major: 0, minor: 2, patch: 0 })

    for (const invalid of ['0.2', 'v0.2.0', '', ' 0.2.0', '1.2.3.4', '100000.0.0', null, undefined]) {
      expect(parseDesktopVersion(invalid)).toBeNull()
    }
  })

  test('compares versions as numbers, not as text', () => {
    expect(isOlderDesktopVersion(version('0.1.4'), version('0.2.0'))).toBe(true)
    expect(isOlderDesktopVersion(version('0.2.0'), version('0.2.0'))).toBe(false)
    expect(isOlderDesktopVersion(version('0.10.0'), version('0.9.9'))).toBe(false)
  })

  test('formats a version as major.minor.patch', () => {
    expect(formatDesktopVersion(version('0.2.0-beta.1'))).toBe('0.2.0')
  })

  test('refuses no app when no minimum is set, and refuses to start on a minimum it cannot read', () => {
    expect(readMinimumDesktopVersion(undefined)).toEqual({ major: 0, minor: 0, patch: 0 })
    expect(readMinimumDesktopVersion('0.2.0')).toEqual({ major: 0, minor: 2, patch: 0 })
    expect(() => readMinimumDesktopVersion('latest')).toThrow('DESKTOP_MINIMUM_VERSION must look like 0.2.0')
    expect(() => readMinimumDesktopVersion('')).toThrow('DESKTOP_MINIMUM_VERSION must look like 0.2.0')
  })

  test('answers 400 without a version, 426 with the minimum for an older app, and lets the rest through', async () => {
    const app = createApp()

    const missing = await app.request('/')

    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'invalid_desktop_version' })

    const garbled = await app.request('/', { headers: { [desktopVersionHeader]: 'latest' } })

    expect(garbled.status).toBe(400)

    const older = await app.request('/', { headers: { [desktopVersionHeader]: '0.1.9' } })

    expect(older.status).toBe(426)
    expect(await older.json()).toEqual({ minimumVersion: '0.2.0' })
    expect(older.headers.get('upgrade')).toBeNull()

    const current = await app.request('/', { headers: { [desktopVersionHeader]: '0.2.0-beta.1' } })

    expect(current.status).toBe(200)
    expect(await current.text()).toBe('0.2.0-beta.1')
  })
})
