import '@tanstack/react-start/server-only'
import {
  type MatchDetailContract,
  type MyReplayContract,
  matchDetailSchema,
  myReplaysSchema,
  type ReplayUploadResultContract,
  replayUploadResultSchema,
} from '@brawltome/contracts'
import type { AccountWriteRequest } from './account-writes'
import { ApiAnswerError, postApiForm, readApi, readApiFile } from './api'
import { failureText } from './optional-read'

export type UploadAnswer =
  | { kind: 'uploaded'; outcomes: ReplayUploadResultContract['outcomes'] }
  | { kind: 'signedOut' }
  | { kind: 'notVerified' }
  | { kind: 'failed' }

// files are about 25 KB; a whole batch still goes in one request well within this
const uploadTimeoutMs = 30_000

/** Sends the visitor's replay files to the api; refuses a request another site made with the visitor's cookie. */
export async function uploadForVisitor(files: File[], request: AccountWriteRequest): Promise<UploadAnswer> {
  if (!request.isSameOrigin) {
    console.error('upload replays: refused a request from another site')

    return { kind: 'failed' }
  }

  if (!request.session.token) return { kind: 'signedOut' }

  const form = new FormData()

  // the api reads the files as an array; oRPC spells array entries in form data with brackets
  for (const [index, file] of files.entries()) form.append(`files[${index}]`, file, file.name)

  try {
    const result = await postApiForm('/replays', form, replayUploadResultSchema, 'upload replays', {
      headers: { 'x-visitor-session': request.session.token },
      timeoutMs: uploadTimeoutMs,
    })

    return { kind: 'uploaded', outcomes: result.outcomes }
  } catch (error) {
    if (error instanceof ApiAnswerError && error.status === 403) return { kind: 'notVerified' }

    if (error instanceof ApiAnswerError && error.status === 401) return { kind: 'signedOut' }

    console.error(failureText(error))

    return { kind: 'failed' }
  }
}

/** The visitor's own uploads, newest first. */
export async function loadMyReplays(sessionToken: string): Promise<MyReplayContract[]> {
  const answer = await readApi('/me/replays', myReplaysSchema, 'load your replays', {
    headers: { 'x-visitor-session': sessionToken },
  })

  return answer.replays
}

function visitorHeaders(sessionToken: string | undefined) {
  return sessionToken ? { headers: { 'x-visitor-session': sessionToken } } : {}
}

/** A match, or null when there is none with that id (or the visitor may not see replays yet). */
export async function loadMatch(matchId: string, sessionToken?: string): Promise<MatchDetailContract | null> {
  try {
    const path = `/matches/${encodeURIComponent(matchId)}`

    return await readApi(path, matchDetailSchema, `load match ${matchId}`, visitorHeaders(sessionToken))
  } catch (error) {
    if (error instanceof ApiAnswerError && (error.status === 404 || error.status === 400)) return null

    throw error
  }
}

/** The replay file as a download; 410 once its patch is no longer kept, 404 for no such match. */
export async function serveReplayFile(matchId: string, sessionToken?: string): Promise<Response> {
  try {
    const path = `/matches/${encodeURIComponent(matchId)}/replay`
    const answer = await readApiFile(path, `download replay ${matchId}`, visitorHeaders(sessionToken))

    return new Response(answer.body, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': answer.headers.get('content-disposition') ?? 'attachment; filename="match.replay"',
        'cache-control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    if (error instanceof ApiAnswerError && error.status === 410)
      return new Response('This replay is no longer kept.', { status: 410 })

    if (error instanceof ApiAnswerError && (error.status === 404 || error.status === 400))
      return new Response('No such match.', { status: 404 })

    console.error(failureText(error))

    return new Response('The replay could not be loaded.', { status: 502 })
  }
}
