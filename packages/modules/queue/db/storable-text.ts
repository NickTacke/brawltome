// postgres text and jsonb reject NUL, and names from the source can carry one into an error. the replacement
// character keeps a trace that something was there
const nul = '\u0000'
const replacement = '\uFFFD'

export function replaceNul(text: string): string {
  return text.replaceAll(nul, replacement)
}

/** A copy of a JSON-like value with NUL replaced in every string, object keys included. */
export function replaceNulInJson<T>(value: T): T {
  if (typeof value === 'string') return replaceNul(value) as T

  if (Array.isArray(value)) return value.map((item) => replaceNulInJson(item)) as T

  if (value === null || typeof value !== 'object') return value

  const entries = Object.entries(value).map(([key, field]) => [replaceNul(key), replaceNulInJson(field)])

  return Object.fromEntries(entries) as T
}
