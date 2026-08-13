const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileVerification = 'valid' | 'invalid' | 'unavailable'

export async function verifyTurnstileResult(token: string, remoteIp: string): Promise<TurnstileVerification> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return 'valid'
    console.error('[TURNSTILE] missing TURNSTILE_SECRET_KEY in production')
    return 'unavailable'
  }

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({ secret, response: token, remoteip: remoteIp }),
    })
    if (!res.ok) return 'unavailable'
    const data = (await res.json()) as { success?: unknown }
    if (data.success === true) return 'valid'
    if (data.success === false) return 'invalid'
    return 'unavailable'
  } catch (err) {
    console.error('[TURNSTILE] verification failed:', err)
    return 'unavailable'
  }
}

export async function verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
  return (await verifyTurnstileResult(token, remoteIp)) === 'valid'
}
