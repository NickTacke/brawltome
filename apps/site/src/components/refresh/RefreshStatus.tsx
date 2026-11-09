import type { RefreshStatus as Status } from './refresh-run'

export type RefreshStatusProps = { status: Status; onRetry: () => void }

/** Follows "Updated … ago" on the same line, so the page doesn't move while a refresh runs. */
export function RefreshStatus({ status, onRetry, hasTextBefore }: RefreshStatusProps & { hasTextBefore: boolean }) {
  const separator = hasTextBefore ? ' · ' : ''

  // the live region is always there while the line is, so screen readers announce what appears in it
  return (
    <span aria-live="polite">
      {status === 'updating' && `${separator}Updating…`}
      {status === 'failed' && (
        <>
          {`${separator}Couldn't update · `}
          <button type="button" onClick={onRetry} className="underline underline-offset-4 hover:text-strong">
            Try again
          </button>
        </>
      )}
    </span>
  )
}
