const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return true
    console.error('[TURNSTILE] missing TURNSTILE_SECRET_KEY in production')
    return false
  }

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({ secret, response: token, remoteip: remoteIp }),
    })
    const data = (await res.json()) as { success: boolean }
    return data.success
  } catch (err) {
    console.error('[TURNSTILE] verification failed:', err)
    return false
  }
}
