import { matchIdSchema } from '@brawltome/contracts'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { loadMatchesPage } from './load-matches-page'
import { loadMyMatches, loadRecentMatches } from './match-lists'
import { loadMatch, uploadForVisitor } from './replay-data'
import { currentSession } from './session-cookie'
import { currentWriteRequest } from './write-request'

export const getMatchesPage = createServerFn({ method: 'GET' }).handler(() => {
  // one visitor's uploads, so no cache between the browser and the site may keep them
  setResponseHeader('cache-control', 'private, no-store')

  return loadMatchesPage(currentSession().token)
})

export const uploadReplays = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error('upload replays: expected form data')

    return data
  })
  .handler(({ data }) => {
    const files = data.getAll('files').filter((value): value is File => value instanceof File)

    return uploadForVisitor(files, currentWriteRequest())
  })

export const getMatch = createServerFn({ method: 'GET' })
  .validator((id: unknown) => matchIdSchema.parse(id))
  .handler(({ data: id }) => {
    // the visitor's session decides whether they may see replays yet
    setResponseHeader('cache-control', 'private, no-store')

    return loadMatch(id, currentSession().token)
  })

type MorePageInput = { list: 'mine' | 'recent'; cursor: string }

/** The next page of one of the matches page's lists. */
export const getMoreMatches = createServerFn({ method: 'GET' })
  .validator((data: unknown): MorePageInput => {
    const input = data as Partial<MorePageInput> | null
    const isList = input?.list === 'mine' || input?.list === 'recent'

    if (!isList || typeof input?.cursor !== 'string') throw new Error('load more matches: expected a list and a cursor')

    return { list: input.list as MorePageInput['list'], cursor: input.cursor }
  })
  .handler(async ({ data }) => {
    setResponseHeader('cache-control', 'private, no-store')

    const token = currentSession().token

    if (data.list === 'recent') return loadRecentMatches(token, data.cursor)

    if (!token) return { matches: [], nextCursor: null }

    const page = await loadMyMatches(token, data.cursor)

    return { matches: page.matches, nextCursor: page.nextCursor }
  })
