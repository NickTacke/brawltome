let registered = false

export async function register() {
  if (registered || process.env.NEXT_RUNTIME !== 'nodejs') return
  registered = true
  const { registerNextNodeTelemetry } = await import('./lib/next-node-telemetry')
  registerNextNodeTelemetry()
}

export async function onRequestError(error: unknown) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { recordNextRequestError } = await import('./lib/next-node-telemetry')
  recordNextRequestError(error)
}
