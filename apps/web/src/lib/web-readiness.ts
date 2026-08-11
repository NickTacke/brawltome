type ReadinessResult = { status: 'ready' } | { status: 'starting'; dependency: 'api'; dependencyStatus?: number }

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export async function checkWebReadiness(apiUrl: string, fetcher: Fetcher = fetch): Promise<ReadinessResult> {
  try {
    const response = await fetcher(`${apiUrl}/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    })
    if (response.ok) return { status: 'ready' }
    return { status: 'starting', dependency: 'api', dependencyStatus: response.status }
  } catch {
    return { status: 'starting', dependency: 'api' }
  }
}
