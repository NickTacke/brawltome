const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login'
const STEAM_IDENTITY_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/

export interface BuildSteamLoginUrlParams {
  returnUrl: string
  realm: string
}

export function buildSteamLoginUrl(params: BuildSteamLoginUrlParams): string {
  const url = new URL(STEAM_OPENID_URL)
  url.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0')
  url.searchParams.set('openid.mode', 'checkid_setup')
  url.searchParams.set('openid.return_to', params.returnUrl)
  url.searchParams.set('openid.realm', params.realm)
  url.searchParams.set('openid.identity', 'http://specs.openid.net/auth/2.0/identifier_select')
  url.searchParams.set('openid.claimed_id', 'http://specs.openid.net/auth/2.0/identifier_select')
  return url.toString()
}

export function extractSteamId(claimedId: string): string | null {
  const match = claimedId.match(STEAM_IDENTITY_PATTERN)
  return match?.[1] ?? null
}

export async function verifySteamLogin(params: Record<string, string>): Promise<string | null> {
  const verifyParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    verifyParams.set(key, value)
  }
  verifyParams.set('openid.mode', 'check_authentication')

  const res = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verifyParams.toString(),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) return null

  const text = await res.text()
  if (!text.includes('is_valid:true')) return null

  const claimedId = params['openid.claimed_id'] ?? ''
  return extractSteamId(claimedId)
}
