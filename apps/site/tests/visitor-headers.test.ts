import { describe, expect, test } from 'bun:test'
import { visitorHeaders } from '../src/server/visitor-headers'

describe('visitorHeaders', () => {
  test('forwards the address traefik saw and the one cloudflare names', () => {
    const headers = visitorHeaders({ realIp: '188.114.97.3', cloudflareIp: '203.0.113.9', peerIp: '10.0.1.5' })

    expect(headers).toEqual({ 'x-visitor-real-ip': '188.114.97.3', 'x-visitor-cf-connecting-ip': '203.0.113.9' })
  })

  test('without traefik in front, the connecting address is the visitor', () => {
    const headers = visitorHeaders({ realIp: undefined, cloudflareIp: undefined, peerIp: '127.0.0.1' })

    expect(headers).toEqual({ 'x-visitor-real-ip': '127.0.0.1' })
  })

  test('forwards nothing when nothing is known', () => {
    expect(visitorHeaders({ realIp: undefined, cloudflareIp: undefined, peerIp: undefined })).toEqual({})
  })
})
