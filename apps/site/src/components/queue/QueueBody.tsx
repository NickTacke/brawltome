import type { LeaderboardRecentActivityOutput } from '@brawltome/contracts'
import { QueueTable, QueueTableSkeleton } from './QueueTable'
import { queueMessage } from './queue-message'

type QueueBodyProps = { view: LeaderboardRecentActivityOutput; isLoading: boolean }

/** The table, a skeleton of it while a slow change loads, or a message saying why there is nothing to list. */
export function QueueBody({ view, isLoading }: QueueBodyProps) {
  if (isLoading) return <QueueTableSkeleton />

  const message = queueMessage(view)

  if (message) {
    return (
      <div className="border-t border-line/40 py-20 text-center">
        <p className="text-lg font-bold text-strong">{message.title}</p>
        <p className="mt-1 text-soft">{message.body}</p>
      </div>
    )
  }

  if (view.status === 'unavailable') return null

  return <QueueTable entries={view.entries} />
}
