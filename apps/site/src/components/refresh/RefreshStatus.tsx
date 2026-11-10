import type { RefreshStatus as Status } from './refresh-run'

export type RefreshStatusProps = { status: Status; onRetry: () => void }

type UpdatedTimeProps = RefreshStatusProps & { updatedText: string | null; hasTextBefore: boolean }

/** "Updated … ago", replaced by "Updating…" while a refresh runs, so the line says one thing at a time. */
export function UpdatedTime({ status, onRetry, updatedText, hasTextBefore }: UpdatedTimeProps) {
  const separator = hasTextBefore ? ' · ' : ''
  const failedSeparator = updatedText ? ' · ' : ''

  // the live region is always there while the line is, so screen readers announce what appears in it
  return (
    <span aria-live="polite" suppressHydrationWarning>
      {status === 'updating' && `${separator}Updating…`}
      {status !== 'updating' && updatedText && `${separator}${updatedText}`}
      {status === 'failed' && (
        <>
          {`${hasTextBefore && !updatedText ? ' · ' : failedSeparator}Couldn't update · `}
          <button type="button" onClick={onRetry} className="underline underline-offset-4 hover:text-strong">
            Try again
          </button>
        </>
      )}
    </span>
  )
}
