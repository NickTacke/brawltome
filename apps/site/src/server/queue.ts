import { createServerFn } from '@tanstack/react-start'
import { type QueueQuery, queueQuery, validateQueueSearch } from '../components/queue/queue-search'
import { loadQueue } from './load-queue'

// checked again here, the address can hold anything
function parseQueueQuery(query: QueueQuery): QueueQuery {
  return queueQuery(validateQueueSearch(query))
}

export const getQueue = createServerFn({ method: 'GET' })
  .validator(parseQueueQuery)
  .handler(({ data }) => loadQueue(data))
