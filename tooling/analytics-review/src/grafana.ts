export type Sample = { metric: Record<string, string>; value: number }

export type GrafanaApi = {
  promInstant(query: string, time: Date): Promise<Sample[]>
  lokiInstant(query: string, time: Date): Promise<Sample[]>
}

type InstantResponse = {
  status?: string
  data?: { result?: Array<{ metric?: Record<string, string>; value?: [number | string, string] }> }
}

export function createGrafanaApi(baseUrl: string, password: string): GrafanaApi {
  const root = baseUrl.replace(/\/+$/, '')
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`

  async function instant(path: string, query: string, time: string): Promise<Sample[]> {
    const url = `${root}${path}?${new URLSearchParams({ query, time })}`
    const response = await fetch(url, { headers: { authorization } })
    if (!response.ok) throw new Error(`Grafana query failed with HTTP ${response.status} for ${path}`)
    const body = (await response.json()) as InstantResponse
    return (body.data?.result ?? []).flatMap((row) =>
      row.value ? [{ metric: row.metric ?? {}, value: Number(row.value[1]) }] : [],
    )
  }

  return {
    promInstant: (query, time) =>
      instant('/api/datasources/proxy/uid/prometheus/api/v1/query', query, String(Math.floor(time.getTime() / 1000))),
    lokiInstant: (query, time) =>
      instant('/api/datasources/proxy/uid/loki/loki/api/v1/query', query, `${BigInt(time.getTime()) * 1_000_000n}`),
  }
}
