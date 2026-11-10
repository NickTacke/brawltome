import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSiteFetch } from '../site-server'

const temporaryDirectories: string[] = []

const failingStartServer = {
  fetch: () => {
    throw new Error('the start server must not be called')
  },
}

const echoStartServer = {
  fetch: (request: Request) => new Response(`rendered ${new URL(request.url).pathname}`),
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('site server', () => {
  test('answers the liveness check without rendering a page', async () => {
    const siteFetch = createSiteFetch(new Map(), failingStartServer)

    const response = await siteFetch(new Request('http://localhost:3000/health/live'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('hands pages to the start server', async () => {
    const siteFetch = createSiteFetch(new Map(), echoStartServer)

    const response = await siteFetch(new Request('http://localhost:3000/privacy'))

    expect(await response.text()).toBe('rendered /privacy')
  })

  test('serves hashed assets from the client build with a long cache', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'brawltome-site-'))

    temporaryDirectories.push(directory)
    const assetPath = join(directory, 'main-abc123.js')

    writeFileSync(assetPath, 'console.log(1)')
    const siteFetch = createSiteFetch(new Map([['/assets/main-abc123.js', assetPath]]), failingStartServer)

    const response = await siteFetch(new Request('http://localhost:3000/assets/main-abc123.js'))

    expect(await response.text()).toBe('console.log(1)')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  test('serves a public file whose name has a space in it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'brawltome-site-'))

    temporaryDirectories.push(directory)
    const bannerPath = join(directory, 'Gold 2.png')

    writeFileSync(bannerPath, 'banner')
    const siteFetch = createSiteFetch(new Map([['/images/banners/Gold 2.png', bannerPath]]), failingStartServer)

    const response = await siteFetch(new Request('http://localhost:3000/images/banners/Gold%202.png'))

    expect(await response.text()).toBe('banner')
  })

  test('hands a path that is not valid percent encoding to the start server', async () => {
    const siteFetch = createSiteFetch(new Map(), echoStartServer)

    const response = await siteFetch(new Request('http://localhost:3000/images/%E0%A4%A'))

    expect(await response.text()).toBe('rendered /images/%E0%A4%A')
  })
})
