import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { knownLegendKeys, legendAvatarUrl } from '../src/components/guild/legend-avatar-url'

const publicRoot = join(import.meta.dir, '..', 'public')
const randomLegendUrl = '/images/legends/random.svg'

function fileForUrl(url: string): string {
  return join(publicRoot, decodeURIComponent(url))
}

describe('legendAvatarUrl', () => {
  test('qinghua & baobao uses the renamed file', () => {
    expect(legendAvatarUrl('qinghua & baobao')).toBe('/images/legends/avatars/qinghua-and-baobao.png')
  })

  test('percent-encodes a name with a space', () => {
    expect(legendAvatarUrl('king zuva')).toBe('/images/legends/avatars/king%20zuva.png')
  })

  test.each([null, 'not a legend', '../../secret', ''])('%p uses the random legend', (legendKey) => {
    expect(legendAvatarUrl(legendKey)).toBe(randomLegendUrl)
  })

  test('the random legend art exists', () => {
    expect(existsSync(fileForUrl(randomLegendUrl))).toBe(true)
  })

  test('every known legend has a file on disk', () => {
    const missing = [...knownLegendKeys].filter((legendKey) => !existsSync(fileForUrl(legendAvatarUrl(legendKey))))

    expect(missing).toEqual([])
  })

  test('no avatar file has a character that breaks once encoded', () => {
    const avatarFiles = readdirSync(join(publicRoot, 'images/legends/avatars'))

    expect(avatarFiles.filter((name) => name.includes('&'))).toEqual([])
  })

  test('every avatar file belongs to a known legend', () => {
    const knownFiles = new Set(
      [...knownLegendKeys].map((legendKey) => basename(fileForUrl(legendAvatarUrl(legendKey)))),
    )

    const avatarFiles = readdirSync(join(publicRoot, 'images/legends/avatars'))

    expect(avatarFiles.filter((name) => !knownFiles.has(name))).toEqual([])
  })
})
