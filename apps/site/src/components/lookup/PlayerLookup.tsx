import type { LookupStatus } from './lookup-run'

type PlayerLookupProps = { playerId: number; status: LookupStatus; onRetry: () => void }

type LookupText = { heading: string; detail: string; hasRetry: boolean }

function lookupText(playerId: number, status: LookupStatus): LookupText {
  const looking = `Looking up player ${playerId}…`
  const failed = `Couldn't look up player ${playerId}`

  switch (status) {
    case 'looking':
      return {
        heading: looking,
        detail: 'Asking Brawlhalla for this player. It usually takes a few seconds.',
        hasRetry: false,
      }
    case 'found':
      return { heading: looking, detail: 'Found. Loading the profile…', hasRetry: false }
    case 'missing':
      return {
        heading: 'Player not found',
        detail: `Brawlhalla didn't return a player with id ${playerId}. Check the id, or try again in a minute.`,
        hasRetry: true,
      }
    case 'refused':
      return {
        heading: failed,
        detail: 'Too many lookups from your connection right now. Wait a minute, then try again.',
        hasRetry: true,
      }
    case 'unverified':
      return { heading: failed, detail: "We couldn't verify your browser, which a lookup needs.", hasRetry: true }
    case 'failed':
      return {
        heading: failed,
        detail: "Something went wrong on our side. It's usually back in a moment.",
        hasRetry: true,
      }
  }
}

/** Stands in for a player page while the api looks up a player the site has never stored. */
export function PlayerLookup({ playerId, status, onRetry }: PlayerLookupProps) {
  const { heading, detail, hasRetry } = lookupText(playerId, status)

  return (
    <div className="py-16" aria-live="polite">
      <h1 className="text-heading font-semibold">{heading}</h1>
      <p className="mt-2 text-soft">{detail}</p>
      {hasRetry && (
        <button type="button" onClick={onRetry} className="mt-4 text-primary underline underline-offset-4">
          Try again
        </button>
      )}
    </div>
  )
}
