'use client'

import { flushAnalytics, referrerDomain, track } from '@/lib/analytics/browser'
import { usePathname } from 'next/navigation'
import { useReportWebVitals } from 'next/web-vitals'
import { useEffect, useRef } from 'react'

const vitalNames = ['LCP', 'INP', 'CLS', 'TTFB'] as const
type VitalName = (typeof vitalNames)[number]

export function AnalyticsProvider() {
  const pathname = usePathname()
  const first = useRef(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname change is the trigger
  useEffect(() => {
    const referrer = first.current ? referrerDomain(document.referrer, window.location.hostname) : undefined
    first.current = false
    track(referrer ? { name: 'pageview', referrerDomain: referrer } : { name: 'pageview' })
  }, [pathname])

  useReportWebVitals((metric) => {
    if ((vitalNames as readonly string[]).includes(metric.name)) {
      track({ name: 'vitals', metric: metric.name as VitalName, value: metric.value })
    }
  })

  useEffect(() => {
    const onError = (event: ErrorEvent) =>
      track({ name: 'error.client', kind: 'unhandled', message: String(event.message) })
    const onRejection = (event: PromiseRejectionEvent) =>
      track({ name: 'error.client', kind: 'rejection', message: String(event.reason) })
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAnalytics()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    document.addEventListener('visibilitychange', onVisibility)
    const timer = setInterval(flushAnalytics, 10_000)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(timer)
    }
  }, [])

  return null
}
