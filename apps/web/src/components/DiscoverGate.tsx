'use client'

import { NavBar } from '@/components/NavBar'
import { Turnstile } from '@marsidev/react-turnstile'
import { useEffect, useState } from 'react'

interface DiscoverGateProps {
  id: string
  label: string
  discoverAction: (id: number, token?: string) => Promise<unknown>
  onDiscovered: (data: unknown) => void
}

export function DiscoverGate({ id, label, discoverAction, onDiscovered }: DiscoverGateProps) {
  const [status, setStatus] = useState<'verifying' | 'discovering' | 'failed'>('verifying')

  const handleTurnstileSuccess = async (token: string) => {
    setStatus('discovering')
    try {
      const data = await discoverAction(Number(id), token)
      if (data) {
        onDiscovered(data)
      } else {
        setStatus('failed')
      }
    } catch {
      setStatus('failed')
    }
  }

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  return (
    <div className="max-w-6xl mx-auto p-6 pt-3 sm:pt-6">
      <NavBar showBack />
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        {status === 'verifying' && (
          <>
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p>Looking up {label}...</p>
            {siteKey && (
              <Turnstile
                siteKey={siteKey}
                onSuccess={handleTurnstileSuccess}
                onError={() => setStatus('failed')}
                onExpire={() => setStatus('failed')}
                options={{ size: 'invisible' }}
              />
            )}
            {!siteKey && (
              <AutoDiscover
                id={id}
                discoverAction={discoverAction}
                onDiscovered={onDiscovered}
                onFailed={() => setStatus('failed')}
              />
            )}
          </>
        )}
        {status === 'discovering' && (
          <>
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p>Discovering {label}...</p>
          </>
        )}
        {status === 'failed' && <p>{label.charAt(0).toUpperCase() + label.slice(1)} not found.</p>}
      </div>
    </div>
  )
}

function AutoDiscover({
  id,
  discoverAction,
  onDiscovered,
  onFailed,
}: {
  id: string
  discoverAction: (id: number, token?: string) => Promise<unknown>
  onDiscovered: (data: unknown) => void
  onFailed: () => void
}) {
  useEffect(() => {
    discoverAction(Number(id))
      .then((data) => {
        if (data) onDiscovered(data)
        else onFailed()
      })
      .catch(() => onFailed())
  }, [id, discoverAction, onDiscovered, onFailed])
  return null
}
