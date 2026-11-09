// the guild endpoints return loosely typed json; these turn one field into a checked value or throw naming the field

type SourceRecord = Record<string, unknown>

export function isSourceRecord(value: unknown): value is SourceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// separators and format characters alone, such as a zero-width space, render as nothing
function hasVisibleText(value: string): boolean {
  return /[^\p{Separator}\p{Format}]/u.test(value)
}

// Postgres can't store U+0000 in text or jsonb, so a value holding one would fail its write every time
export function withoutNulCharacters(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('\u0000', '')

  if (Array.isArray(value)) return value.map(withoutNulCharacters)

  if (!isSourceRecord(value)) return value

  const entries = Object.entries(value).map(([key, item]) => [key, withoutNulCharacters(item)])

  return Object.fromEntries(entries)
}

export function parseNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }

  return value as number
}

type TextRules = { maximumLength?: number; isVisibleTextRequired?: boolean }

// the length counts code points, the way the source limits names
export function parseText(value: unknown, field: string, rules: TextRules = {}): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)

  if (rules.maximumLength !== undefined && [...value].length > rules.maximumLength) {
    throw new Error(`${field} is too long`)
  }

  if (rules.isVisibleTextRequired && !hasVisibleText(value)) throw new Error(`${field} must be visible`)

  return value
}

// blank text is stored as missing, so a member shows no name rather than an invisible one
export function parseOptionalText(value: unknown, field: string, maximumLength: number): string | null {
  if (value == null) return null

  const text = parseText(value, field, { maximumLength })

  return hasVisibleText(text) ? text : null
}

// the source sends dates as unix seconds
export function parseSourceDate(value: unknown, field: string): Date {
  const date = new Date(parseNonNegativeInteger(value, field) * 1_000)

  if (Number.isNaN(date.getTime())) throw new Error(`${field} is outside the supported date range`)

  return date
}

export function parseOptionalSourceDate(value: unknown, field: string): Date | null {
  if (value == null) return null

  return parseSourceDate(value, field)
}

// xp and guild points outgrow safe integers, so they stay decimal strings that fit numeric(40, 0)
export function parseDecimal(value: unknown, field: string): string {
  if (typeof value === 'string' && /^(0|[1-9]\d{0,39})$/.test(value)) return value

  if (Number.isSafeInteger(value) && (value as number) >= 0) return String(value)

  throw new Error(`${field} must be an exact non-negative decimal integer`)
}

export function parseOptionalDecimal(value: unknown, field: string): string | null {
  if (value == null) return null

  return parseDecimal(value, field)
}
