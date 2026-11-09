export function failureText(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown failure'
}

// a short limit, so a slow optional read can't double how long the visitor waits for numbers that only decorate the page
export const optionalRead = { timeoutMs: 3_000 }

// these numbers only decorate the page, so it is still worth showing without them
export async function readOptional<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch (error) {
    console.error(failureText(error))

    return fallback
  }
}
