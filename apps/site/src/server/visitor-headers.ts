/** What the server functions know about the visitor a refresh is asked for. */
export type Visitor = {
  headers: Record<string, string>
  refreshTrust: string | undefined
  keepRefreshTrust: (token: string) => void
}

type IngressEvidence = { realIp: string | undefined; cloudflareIp: string | undefined; peerIp: string | undefined }

/**
 * The ingress evidence of the visitor's request, under names the api only reads from a caller holding the internal
 * secret. The api decides which address to charge, with the same cloudflare rule it uses for its own ingress.
 */
export function visitorHeaders({ realIp, cloudflareIp, peerIp }: IngressEvidence): Record<string, string> {
  const headers: Record<string, string> = {}
  // traefik replaces x-real-ip with the address that connected to it; without traefik, that address is the peer
  const ingressPeer = realIp ?? peerIp

  if (ingressPeer) headers['x-visitor-real-ip'] = ingressPeer

  if (cloudflareIp) headers['x-visitor-cf-connecting-ip'] = cloudflareIp

  return headers
}
