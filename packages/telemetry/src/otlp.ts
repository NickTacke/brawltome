export function otlpSignalUrl(endpoint: string, signal: 'logs' | 'traces'): URL {
  const url = new URL(endpoint)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('OTLP endpoint must be an HTTP(S) URL without credentials, query, or fragment')
  }
  const suffix = `/v1/${signal}`
  if (!url.pathname.endsWith(suffix)) url.pathname = `${url.pathname.replace(/\/$/, '')}${suffix}`
  return url
}
