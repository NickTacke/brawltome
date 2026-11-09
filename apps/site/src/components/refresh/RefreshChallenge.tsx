import { Turnstile } from '@marsidev/react-turnstile'
import type { Challenge } from './use-live-refresh'

/** Cloudflare's invisible challenge; it only shows something when it can't tell the visitor from a bot. */
export function RefreshChallenge({ challenge }: { challenge: Challenge | null }) {
  if (!challenge) return null

  const fail = () => challenge.settle(null)

  return (
    <Turnstile
      siteKey={challenge.siteKey}
      onSuccess={(turnstileToken) => challenge.settle(turnstileToken)}
      onError={fail}
      onExpire={fail}
      options={{ size: 'invisible' }}
    />
  )
}
