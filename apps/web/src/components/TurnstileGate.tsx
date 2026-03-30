'use client'

import { Turnstile } from '@marsidev/react-turnstile'
import { useEffect, useState } from 'react'

interface TurnstileGateProps {
  onToken: (token: string) => void
  onError?: () => void
}

export function TurnstileGate({ onToken, onError }: TurnstileGateProps) {
  const [failed, setFailed] = useState(false)

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  // Dev mode — no site key, fire immediately with empty token
  useEffect(() => {
    if (!siteKey) onToken('')
  }, [siteKey, onToken])

  if (failed) return null
  if (!siteKey) return null

  return (
    <Turnstile
      siteKey={siteKey}
      onSuccess={onToken}
      onError={() => {
        setFailed(true)
        onError?.()
      }}
      onExpire={() => {
        setFailed(true)
        onError?.()
      }}
      options={{ size: 'invisible' }}
    />
  )
}
