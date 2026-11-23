const LOWEST_SHOWN_PERCENT = 0.01

// '<0.01%' for a share too small for two decimals, so it never reads as nothing or as more; the log does the same
export function percentText(percent: number): string {
  if (percent < LOWEST_SHOWN_PERCENT) return '<0.01%'

  return `${percent.toFixed(2)}%`
}

export function requestText(requestCount: number): string {
  return requestCount === 1 ? '1 request' : `${requestCount} requests`
}
