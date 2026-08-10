const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login'
const OPENID_NAMESPACE = 'http://specs.openid.net/auth/2.0'
const STEAM_IDENTITY_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/
const NONCE_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/
const MAX_NONCE_AGE_MS = 10 * 60 * 1000
const MAX_NONCE_FUTURE_SKEW_MS = 60 * 1000

export interface BuildSteamLoginUrlParams {
  returnUrl: string
  realm: string
}

export function buildSteamLoginUrl(params: BuildSteamLoginUrlParams): string {
  const url = new URL(STEAM_OPENID_URL)
  url.searchParams.set('openid.ns', OPENID_NAMESPACE)
  url.searchParams.set('openid.mode', 'checkid_setup')
  url.searchParams.set('openid.return_to', params.returnUrl)
  url.searchParams.set('openid.realm', params.realm)
  url.searchParams.set('openid.identity', `${OPENID_NAMESPACE}/identifier_select`)
  url.searchParams.set('openid.claimed_id', `${OPENID_NAMESPACE}/identifier_select`)
  return url.toString()
}

export function extractSteamId(claimedId: string): string | null {
  const match = claimedId.match(STEAM_IDENTITY_PATTERN)
  return match?.[1] ?? null
}

export async function verifySteamLogin(
  params: Record<string, string>,
  expectedReturnTo: string,
  now: Date = new Date(),
): Promise<string | null> {
  const claimedId = params['openid.claimed_id'] ?? ''
  const signedFields = new Set((params['openid.signed'] ?? '').split(','))
  const requiredSignedFields = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce']
  if (
    !requiredSignedFields.every((field) => signedFields.has(field)) ||
    params['openid.ns'] !== OPENID_NAMESPACE ||
    params['openid.mode'] !== 'id_res' ||
    params['openid.op_endpoint'] !== STEAM_OPENID_URL ||
    params['openid.return_to'] !== expectedReturnTo ||
    params['openid.identity'] !== claimedId ||
    !nonceIsFresh(params['openid.response_nonce'], now)
  ) {
    return null
  }

  const steamId = extractSteamId(claimedId)
  if (!steamId) return null

  const verifyParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) verifyParams.set(key, value)
  verifyParams.set('openid.mode', 'check_authentication')

  const res = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verifyParams.toString(),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null

  const text = await res.text()
  return text.includes('is_valid:true') ? steamId : null
}

function nonceIsFresh(nonce: string | undefined, now: Date): boolean {
  const timestamp = nonce?.match(NONCE_TIMESTAMP_PATTERN)?.[1]
  if (!timestamp) return false
  const nonceTime = Date.parse(timestamp)
  const age = now.getTime() - nonceTime
  return Number.isFinite(nonceTime) && age <= MAX_NONCE_AGE_MS && age >= -MAX_NONCE_FUTURE_SKEW_MS
}
