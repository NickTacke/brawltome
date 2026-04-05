'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

import { BrandSocialPills } from './BrandSocialPills'

function getTimeRemaining(endTime: string) {
  const total = new Date(endTime).getTime() - Date.now()
  if (total <= 0) return null

  return {
    days: Math.floor(total / (1000 * 60 * 60 * 24)),
    hours: Math.floor((total / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((total / (1000 * 60)) % 60),
    seconds: Math.floor((total / 1000) % 60),
  }
}

function CountdownTimer({ endTime }: { endTime: string }) {
  const [remaining, setRemaining] = useState(() => getTimeRemaining(endTime))

  useEffect(() => {
    const interval = setInterval(() => {
      const time = getTimeRemaining(endTime)
      setRemaining(time)
      if (!time) clearInterval(interval)
    }, 1000)
    return () => clearInterval(interval)
  }, [endTime])

  if (!remaining) return null

  const segments = [
    { value: remaining.days, label: 'Days' },
    { value: remaining.hours, label: 'Hours' },
    { value: remaining.minutes, label: 'Minutes' },
    { value: remaining.seconds, label: 'Seconds' },
  ]

  return (
    <div className="flex gap-3 sm:gap-4">
      {segments.map(({ value, label }) => (
        <div key={label} className="flex flex-col items-center">
          <div className="bg-card border border-border rounded-lg w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center shadow-md">
            <span className="text-2xl sm:text-3xl font-bold text-foreground tabular-nums">
              {String(value).padStart(2, '0')}
            </span>
          </div>
          <span className="text-xs sm:text-sm text-muted-foreground mt-2">{label}</span>
        </div>
      ))}
    </div>
  )
}

export function MaintenancePage({ maintenanceEnd }: { maintenanceEnd?: string }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative">
      <div className="flex flex-col items-center text-center max-w-lg">
        <div className="mb-8">
          <Image
            src="/images/logo.png"
            alt="BrawlTome Logo"
            width={400}
            height={100}
            priority
            className="h-auto w-auto max-w-[80vw] md:max-w-md"
          />
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3">We&apos;ll be back soon</h1>
        <p className="text-lg text-muted-foreground mb-8">
          We&apos;re performing scheduled maintenance. Thanks for your patience.
        </p>

        {maintenanceEnd && (
          <div className="mb-10">
            <CountdownTimer endTime={maintenanceEnd} />
          </div>
        )}

        <BrandSocialPills />
      </div>
    </main>
  )
}
