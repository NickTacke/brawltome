import { type ReactNode, useState } from 'react'
import { getMoreMatches } from '../../server/replays'
import { sectionTitle } from '../player/player-styles'
import { MatchRow } from './MatchRow'
import { joinPages, withNextPage } from './match-pages'
import type { MatchList as MatchListData } from './matches-model'

type MatchListProps = {
  title: string
  list: 'mine' | 'recent'
  page: MatchListData
  yourId: number | null
  now: Date
  // what the section shows before there is any match in it
  empty: ReactNode
}

/** A titled list of matches that fetches its next page in place. */
export function MatchList({ title, list, page, yourId, now, empty }: MatchListProps) {
  // every match seen once Show more is used; a reload while an upload is read brings a new first page and keeps these
  const [kept, setKept] = useState<MatchListData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const shown = joinPages(page, kept)

  async function showMore() {
    if (!shown.nextCursor) return

    setIsLoading(true)

    const next = await getMoreMatches({ data: { list, cursor: shown.nextCursor } }).catch(() => null)

    setIsLoading(false)

    if (next) setKept(withNextPage(shown, next))
  }

  return (
    <section>
      <h2 className={sectionTitle}>{title}</h2>
      {shown.matches.length === 0 ? (
        <div className="mt-3">{empty}</div>
      ) : (
        <ul className="mt-1.5">
          {shown.matches.map((match) => (
            <MatchRow key={match.id} match={match} yourId={yourId} now={now} />
          ))}
        </ul>
      )}
      {shown.nextCursor && (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={() => void showMore()}
            disabled={isLoading}
            className="text-sm font-semibold text-soft transition-colors hover:text-strong disabled:opacity-60"
          >
            {isLoading ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </section>
  )
}
