import '@tanstack/react-start/server-only'
import type { ZodType } from 'zod'

const defaultTimeoutMs = 10_000

// headers carry what the api needs to know about the visitor a call is made for
type RequestOptions = { timeoutMs?: number; headers?: Record<string, string> }

function readSetting(name: 'INTERNAL_API_URL' | 'INTERNAL_API_SECRET', description: string): string {
  const value = process.env[name]

  if (!value) throw new Error(`${description}: ${name} is not set`)

  return value
}

/** The api answered, but not with 2xx; the status tells a caller what happened (403, 404, 410). */
export class ApiAnswerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

function describeError(error: unknown): { name: string; code?: string } {
  if (!(error instanceof Error)) return { name: 'unknown' }

  return { name: error.name, code: (error as NodeJS.ErrnoException).code }
}

// errors from fetch and json parsing can quote the url or the body, and these messages can reach the browser
async function withFailureMessage<T>(
  work: () => Promise<T>,
  failure: string,
  description: string,
  timeoutMs: number,
): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (isTimeout(error)) throw new Error(`${description}: api gave no answer within ${timeoutMs} ms`)

    // only the kind of failure, the message can quote the url
    console.error(`${description}: ${failure}`, describeError(error))

    throw new Error(`${description}: ${failure}`)
  }
}

async function fetchApi(
  path: string,
  init: RequestInit,
  description: string,
  { timeoutMs = defaultTimeoutMs, headers: extraHeaders = {} }: RequestOptions,
): Promise<Response> {
  const apiUrl = readSetting('INTERNAL_API_URL', description)
  const internalSecret = readSetting('INTERNAL_API_SECRET', description)

  // the given headers go first, so they can never replace the secret or the content type
  const headers = new Headers(extraHeaders)

  for (const [name, value] of new Headers(init.headers)) headers.set(name, value)

  headers.set('x-internal-secret', internalSecret)

  // redirect is refused because fetch would resend the secret header to wherever it points
  const request = { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) } as const

  const response = await withFailureMessage(
    () => fetch(`${apiUrl}/v1${path}`, request),
    'could not reach the api',
    description,
    timeoutMs,
  )

  if (!response.ok) throw new ApiAnswerError(`${description}: api answered ${response.status}`, response.status)

  return response
}

async function requestApi<T>(
  path: string,
  init: RequestInit,
  schema: ZodType<T>,
  description: string,
  options: RequestOptions,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
  const response = await fetchApi(path, init, description, options)

  const answer: unknown = await withFailureMessage(
    () => response.json(),
    'api answered invalid json',
    description,
    timeoutMs,
  )

  const parsedAnswer = schema.safeParse(answer)

  if (!parsedAnswer.success) throw new Error(`${description}: api answered an unexpected shape`)

  return parsedAnswer.data
}

/** Calls GET /v1{path} on the API as an internal caller. Only for server functions: it reads the internal secret. */
export function readApi<T>(
  path: string,
  schema: ZodType<T>,
  description: string,
  options: RequestOptions = {},
): Promise<T> {
  return requestApi(path, { method: 'GET' }, schema, description, options)
}

/**
 * Calls a writing method on /v1{path} as an internal caller, with the body as json when there is one. Only for server
 * functions: it reads the internal secret.
 */
export function writeApi<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  schema: ZodType<T>,
  description: string,
  options: RequestOptions = {},
): Promise<T> {
  if (body === undefined) return requestApi(path, { method }, schema, description, options)

  const init = {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }

  return requestApi(path, init, schema, description, options)
}

/** Calls POST /v1{path} on the API as an internal caller. Only for server functions: it reads the internal secret. */
export function postApi<T>(
  path: string,
  body: unknown,
  schema: ZodType<T>,
  description: string,
  options: RequestOptions = {},
): Promise<T> {
  return writeApi('POST', path, body, schema, description, options)
}

/** Calls POST /v1{path} with a multipart body, for file uploads. Only for server functions. */
export function postApiForm<T>(
  path: string,
  form: FormData,
  schema: ZodType<T>,
  description: string,
  options: RequestOptions = {},
): Promise<T> {
  return requestApi(path, { method: 'POST', body: form }, schema, description, options)
}

/** Calls GET /v1{path} and hands back the answer as it came, for files. Only for server functions. */
export function readApiFile(path: string, description: string, options: RequestOptions = {}): Promise<Response> {
  return fetchApi(path, { method: 'GET' }, description, options)
}
