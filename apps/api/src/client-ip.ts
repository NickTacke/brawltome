import { isIP } from 'node:net'

function trustedProxyAddress(address: string): boolean {
  if (address === '::1' || address.startsWith('::ffff:127.')) return true
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
