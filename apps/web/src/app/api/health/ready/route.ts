import { resolveServerApiUrl } from '@/lib/api-url'
import { checkWebReadiness } from '@/lib/web-readiness'

export async function GET(): Promise<Response> {
  const readiness = await checkWebReadiness(resolveServerApiUrl())
  return Response.json(readiness, {
    status: readiness.status === 'ready' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}
