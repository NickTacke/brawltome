type ApiUrlEnvironment = {
  INTERNAL_API_URL?: string
  NEXT_PUBLIC_API_URL?: string
}

export const publicApiUrl = normalizeHttpUrl(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000')

export function resolveServerApiUrl(
  environment: ApiUrlEnvironment = {
    INTERNAL_API_URL: process.env.INTERNAL_API_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
): string {
  return normalizeHttpUrl(environment.INTERNAL_API_URL ?? environment.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000')
}

function normalizeHttpUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API origin must be an HTTP URL')
  if (url.username || url.password) throw new Error('API origin must not contain credentials')
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error('API origin must not contain a path, query, or fragment')
  return url.origin
}
