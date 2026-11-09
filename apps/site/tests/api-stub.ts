import { afterEach, beforeEach, mock, spyOn } from 'bun:test'

export const apiUrl = 'http://api.test'

export type StubAnswer = { status: number; body: unknown }

const originalFetch = globalThis.fetch
const originalApiUrl = process.env.INTERNAL_API_URL
const originalSecret = process.env.INTERNAL_API_SECRET

// assigning undefined would store the text "undefined"
function restoreSetting(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

/** Points the api client at a fake api for each test in the file, and puts everything back afterwards. */
export function useApiSettings() {
  beforeEach(() => {
    process.env.INTERNAL_API_URL = apiUrl
    process.env.INTERNAL_API_SECRET = 'test-internal-secret'
    spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreSetting('INTERNAL_API_URL', originalApiUrl)
    restoreSetting('INTERNAL_API_SECRET', originalSecret)
    mock.restore()
  })
}

/** Answers every fetch with `answer` and returns the urls asked for, with the api's base taken off. */
export function stubFetch(answer: (url: string) => StubAnswer): string[] {
  const urls: string[] = []

  const stub = async (input: string | URL | Request) => {
    const url = String(input)

    urls.push(url.replace(`${apiUrl}/v1`, ''))

    const { status, body } = answer(url)

    return new Response(JSON.stringify(body), { status })
  }

  globalThis.fetch = mock(stub) as unknown as typeof fetch

  return urls
}
