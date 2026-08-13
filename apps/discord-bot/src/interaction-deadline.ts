class InteractionDeadlineError extends Error {
  override name = 'TimeoutError'
}

export async function runBeforeInteractionDeadline<T>(options: {
  deadline: number
  requestTimeoutMs: number
  now: () => number
  work: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  const remainingMs = options.deadline - options.now()
  if (remainingMs <= 0) throw new InteractionDeadlineError('Interaction deadline reached')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(remainingMs, options.requestTimeoutMs)))
  try {
    return await options.work(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw new InteractionDeadlineError('Interaction request timed out')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
