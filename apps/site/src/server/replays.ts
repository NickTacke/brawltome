import { matchIdSchema } from '@brawltome/contracts'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { loadMatchesPage } from './load-matches-page'
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
  .handler(({ data: id }) => loadMatch(id))
