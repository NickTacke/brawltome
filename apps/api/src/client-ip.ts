import { isIP } from 'node:net'

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

export function requestWithVerifiedClientIp(request: Request, peerAddress: string): Request {
  const forwarded =
    request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const clientIp = trustedProxyAddress(peerAddress) && forwarded && isIP(forwarded) ? forwarded : peerAddress
  const headers = new Headers(request.headers)
  headers.set('x-client-ip', clientIp)
  return new Request(request, { headers })
}
