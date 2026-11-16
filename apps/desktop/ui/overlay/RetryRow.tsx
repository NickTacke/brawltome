type RetryRowProps = { note: string | null; canRetry: boolean; onRetry: () => void }

// the row under a failed card: when the app asks again on its own, and a button to ask now
export function RetryRow({ note, canRetry, onRetry }: RetryRowProps) {
  if (note === null && !canRetry) return null

  return (
    <span className="plain-row">
      <span className="note">{note}</span>
      {canRetry && (
        <button type="button" className="text-button" onClick={onRetry}>
          Retry
        </button>
      )}
    </span>
  )
}

export function retryCountdown(retryInSeconds: number | null): string | null {
  if (retryInSeconds === null) return null

  return `Try again in ${retryInSeconds}s`
}
