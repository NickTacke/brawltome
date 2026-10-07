import { BlockList, isIP } from 'node:net'

// Bun reports IPv4 peers on a dual-stack socket as IPv4-mapped IPv6 (`::ffff:10.0.5.114`).
function withoutIpv4MappedPrefix(address: string): string {
  return address.toLowerCase().startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address
}

function trustedProxyAddress(peerAddress: string): boolean {
  if (peerAddress === '::1') return true
  const address = withoutIpv4MappedPrefix(peerAddress)
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

// https://www.cloudflare.com/ips/ (checked 2026-10-07).
const cloudflareRanges = new BlockList()
for (const range of [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]) {
  const [network, prefix] = range.split('/')
  cloudflareRanges.addSubnet(network, Number(prefix), isIP(network) === 6 ? 'ipv6' : 'ipv4')
}

function cloudflareAddress(address: string): boolean {
  const normalized = withoutIpv4MappedPrefix(address)
  const family = isIP(normalized)
  return family !== 0 && cloudflareRanges.check(normalized, family === 6 ? 'ipv6' : 'ipv4')
}

function validIp(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && isIP(trimmed) ? trimmed : null
}

export function requestWithVerifiedClientIp(request: Request, peerAddress: string): Request {
  let clientIp = peerAddress
  if (trustedProxyAddress(peerAddress)) {
    const cloudflareVisitor = validIp(request.headers.get('cf-connecting-ip'))
    // Traefik replaces X-Real-Ip with the address that connected to it, so a client cannot forge it. Through Traefik,
    // only a Cloudflare edge may name the visitor; anyone reaching the origin directly is charged to their own address.
    const ingressPeer = validIp(request.headers.get('x-real-ip'))
    if (ingressPeer) {
      clientIp = cloudflareAddress(ingressPeer) && cloudflareVisitor ? cloudflareVisitor : ingressPeer
    } else {
      // Internal callers such as the web server forward the visitor they are acting for.
      clientIp = cloudflareVisitor ?? validIp(request.headers.get('x-forwarded-for')?.split(',')[0]) ?? peerAddress
    }
  }
  const headers = new Headers(request.headers)
  headers.set('x-client-ip', clientIp)
  return new Request(request, { headers })
}
