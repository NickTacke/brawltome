import type { ZodType } from 'zod'

const requestTimeoutMs = 10_000

function readSetting(name: 'INTERNAL_API_URL' | 'INTERNAL_API_SECRET', description: string): string {
  const value = process.env[name]

  if (!value) throw new Error(`${description}: ${name} is not set`)

  return value
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

// errors from fetch and json parsing can quote the url or the body, and these messages can reach the browser
async function withFailureMessage<T>(work: () => Promise<T>, failure: string, description: string): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (isTimeout(error)) throw new Error(`${description}: api gave no answer within ${requestTimeoutMs} ms`)

    throw new Error(`${description}: ${failure}`)
  }
}

async function requestApi<T>(path: string, init: RequestInit, schema: ZodType<T>, description: string): Promise<T> {
  const apiUrl = readSetting('INTERNAL_API_URL', description)
  const internalSecret = readSetting('INTERNAL_API_SECRET', description)

  const headers = new Headers(init.headers)

  headers.set('x-internal-secret', internalSecret)

  // redirect is refused because fetch would resend the secret header to wherever it points
  const request = { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs) } as const

  const response = await withFailureMessage(
    () => fetch(`${apiUrl}/v1${path}`, request),
    'could not reach the api',
    description,
  )

  if (!response.ok) throw new Error(`${description}: api answered ${response.status}`)

  const answer: unknown = await withFailureMessage(() => response.json(), 'api answered invalid json', description)
  const parsedAnswer = schema.safeParse(answer)

  if (!parsedAnswer.success) throw new Error(`${description}: api answered an unexpected shape`)

  return parsedAnswer.data
}

/** Calls GET /v1{path} on the API as an internal caller. Only for server functions: it reads the internal secret. */
export function readApi<T>(path: string, schema: ZodType<T>, description: string): Promise<T> {
  return requestApi(path, { method: 'GET' }, schema, description)
}

/** Calls POST /v1{path} on the API as an internal caller. Only for server functions: it reads the internal secret. */
export function postApi<T>(path: string, body: unknown, schema: ZodType<T>, description: string): Promise<T> {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }

  return requestApi(path, init, schema, description)
}
