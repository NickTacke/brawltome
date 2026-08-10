import { describe, expect, test } from 'bun:test'
import { requestWithVerifiedClientIp } from '../src/client-ip'

function verified(peerAddress: string, headers: Record<string, string>): string | null {
  const request = new Request('http://localhost/api/overlay/opponent/42', { headers })
  return requestWithVerifiedClientIp(request, peerAddress).headers.get('x-client-ip')
}

describe('verified client IP', () => {
  test('ignores spoofed forwarding headers from direct public clients', () => {
    expect(
      verified('203.0.113.10', {
        'x-client-ip': '198.51.100.1',
        'cf-connecting-ip': '198.51.100.2',
        'x-forwarded-for': '198.51.100.3',
      }),
    ).toBe('203.0.113.10')
  })

  test('accepts one valid ingress address only from a private trusted proxy', () => {
    expect(verified('172.18.0.2', { 'cf-connecting-ip': '203.0.113.42' })).toBe('203.0.113.42')
    expect(verified('127.0.0.1', { 'x-forwarded-for': '198.51.100.5, 172.18.0.2' })).toBe('198.51.100.5')
    expect(verified('172.18.0.2', { 'cf-connecting-ip': 'not-an-ip' })).toBe('172.18.0.2')
  })
})
