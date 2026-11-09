import { describe, expect, test } from 'bun:test'
import { readClientIp, requestWithVerifiedClientIp } from '../src/client-ip'

const internalSecret = 'client-ip-test-internal-secret-0123456789'

function verified(peerAddress: string, headers: Record<string, string>): string | null {
  const request = new Request('http://localhost/api/overlay/opponent/42', { headers })

  return requestWithVerifiedClientIp(request, peerAddress, internalSecret).headers.get('x-client-ip')
}

function forwardedBySite(headers: Record<string, string>, secret = internalSecret): string | null {
  return verified('172.18.0.9', { 'x-internal-secret': secret, ...headers })
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

  test('trusts private proxies reported as IPv4-mapped IPv6 peers', () => {
    expect(verified('::ffff:10.0.5.114', { 'x-forwarded-for': '203.0.113.7' })).toBe('203.0.113.7')
    expect(verified('::ffff:127.0.0.1', { 'cf-connecting-ip': '203.0.113.8' })).toBe('203.0.113.8')
    expect(verified('::ffff:203.0.113.10', { 'x-forwarded-for': '198.51.100.3' })).toBe('::ffff:203.0.113.10')
  })

  test('through Traefik, trusts the visitor address only when Cloudflare connected', () => {
    expect(verified('10.0.1.5', { 'x-real-ip': '188.114.97.3', 'cf-connecting-ip': '203.0.113.9' })).toBe('203.0.113.9')

    expect(verified('10.0.1.5', { 'x-real-ip': '2606:4700::6810:1', 'cf-connecting-ip': '203.0.113.9' })).toBe(
      '203.0.113.9',
    )

    expect(
      verified('10.0.1.5', {
        'x-real-ip': '198.51.100.20',
        'cf-connecting-ip': '203.0.113.9',
        'x-forwarded-for': '203.0.113.10',
      }),
    ).toBe('198.51.100.20')

    expect(verified('10.0.1.5', { 'x-real-ip': '188.114.97.3' })).toBe('188.114.97.3')
  })
})

describe('visitor forwarded by an internal caller', () => {
  test('charges the visitor the site names, not the site', () => {
    expect(forwardedBySite({ 'x-visitor-real-ip': '198.51.100.20' })).toBe('198.51.100.20')
  })

  test('takes the address Cloudflare names only when Cloudflare connected to the ingress', () => {
    const cloudflareEdge = { 'x-visitor-real-ip': '188.114.97.3', 'x-visitor-cf-connecting-ip': '203.0.113.9' }
    const directVisitor = { 'x-visitor-real-ip': '198.51.100.20', 'x-visitor-cf-connecting-ip': '203.0.113.9' }

    expect(forwardedBySite(cloudflareEdge)).toBe('203.0.113.9')
    expect(forwardedBySite(directVisitor)).toBe('198.51.100.20')
  })

  test('ignores the visitor headers without the internal secret', () => {
    const headers = { 'x-visitor-real-ip': '198.51.100.20' }

    expect(verified('172.18.0.9', headers)).toBe('172.18.0.9')
    expect(verified('203.0.113.10', headers)).toBe('203.0.113.10')
    expect(forwardedBySite(headers, 'wrong-secret-of-the-same-length-0123456')).toBe('172.18.0.9')
  })

  test('ignores the visitor headers when the api has no internal secret', () => {
    const request = new Request('http://localhost/v1/players/7/refresh', {
      headers: { 'x-internal-secret': internalSecret, 'x-visitor-real-ip': '198.51.100.20' },
    })

    expect(requestWithVerifiedClientIp(request, '172.18.0.9', undefined).headers.get('x-client-ip')).toBe('172.18.0.9')
  })

  test('ignores a forwarded address that is not an ip', () => {
    expect(forwardedBySite({ 'x-visitor-real-ip': 'not-an-ip' })).toBe('172.18.0.9')
  })
})

describe('readClientIp', () => {
  test('reads the client address from the verified header first', () => {
    const headers = new Headers({ 'x-client-ip': '203.0.113.7', 'cf-connecting-ip': '198.51.100.1' })

    expect(readClientIp(headers)).toBe('203.0.113.7')
    expect(readClientIp(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe('198.51.100.2')
    expect(readClientIp(new Headers())).toBe('0.0.0.0')
  })
})
