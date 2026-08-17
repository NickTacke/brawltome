import { describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { proxy } from '../src/proxy'

describe('web proxy Queue preferences', () => {
  test('persists valid Queue URL filters for hydrated, deep-link, and no-JS requests', () => {
    const response = proxy(new NextRequest('https://brawltome.app/queue?mode=2v2&region=EU'))

    expect(response.cookies.get('brawltome-queue')?.value).toBe('v1.2v2.EU')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=31536000')
    expect(response.headers.get('set-cookie')).toContain('Path=/')
    expect(response.headers.get('set-cookie')).toContain('SameSite=lax')
  })

  test('does not persist incomplete, invalid, or unrelated URLs', () => {
    for (const url of [
      'https://brawltome.app/queue?mode=2v2',
      'https://brawltome.app/queue?mode=retired&region=EU',
      'https://brawltome.app/player/42?mode=2v2&region=EU',
    ]) {
      expect(proxy(new NextRequest(url)).cookies.get('brawltome-queue')).toBeUndefined()
    }
  })
})
