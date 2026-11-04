function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

export function requirePositiveInteger(value: number, name: string): number {
  if (!isPositiveInteger(value)) {
    throw new Error(`${name} must be a positive integer, got ${value}`)
  }

  return value
}

export type ParsePositiveIntegerOptions = {
  name: string
  fallback: number
  maximum?: number
}

/** Reads a positive integer from environment text. Missing text means the fallback. */
export function parsePositiveInteger(text: string | undefined, options: ParsePositiveIntegerOptions): number {
  const { name, fallback, maximum } = options

  if (text === undefined) {
    const validFallback = requirePositiveInteger(fallback, name)

    return requireAtMost(validFallback, name, maximum)
  }

  const parsed = Number(text)

  if (text.trim() === '' || !isPositiveInteger(parsed)) {
    throw new Error(`${name} must be a positive integer, got ${text}`)
  }

  return requireAtMost(parsed, name, maximum)
}

export type ParseBoundedIntegerOptions = {
  name: string
  fallback: number
  minimum: number
  maximum: number
}

/** Reads an integer from minimum to maximum, inclusive, from environment text. Missing text means the fallback. */
export function parseBoundedInteger(text: string | undefined, options: ParseBoundedIntegerOptions): number {
  const { name, fallback, minimum, maximum } = options
  const value = text === undefined ? fallback : Number(text)
  // Number('') is 0, which would slip through a minimum of 0
  const isBlank = text !== undefined && text.trim() === ''

  if (isBlank || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}, got ${text ?? fallback}`)
  }

  return value
}

function requireAtMost(value: number, name: string, maximum: number | undefined): number {
  if (maximum !== undefined && value > maximum) {
    throw new Error(`${name} must be at most ${maximum}`)
  }

  return value
}
