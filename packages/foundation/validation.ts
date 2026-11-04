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

function requireAtMost(value: number, name: string, maximum: number | undefined): number {
  if (maximum !== undefined && value > maximum) {
    throw new Error(`${name} must be at most ${maximum}`)
  }

  return value
}
