export function GET(): Response {
  return Response.json({ status: 'live' }, { headers: { 'cache-control': 'no-store' } })
}
