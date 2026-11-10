// Serves the built site. The TanStack Start build only exports a fetch handler, so something has to listen on the port
// and answer for the files in dist/client.
//
// On SIGTERM it drains for zero-downtime deploys (see infra/app/deploy.sh): /health/serving reports draining while
// pages are still answered, so Traefik's health check moves traffic to the replacement before the port closes.
import { join, resolve } from 'node:path'

type SiteFetch = (request: Request) => Response | Promise<Response>
type StartServer = { fetch: SiteFetch }
type IsDraining = () => boolean

const siteRoot = resolve(import.meta.dir, '../../apps/site/dist')
const clientRoot = join(siteRoot, 'client')
const immutableCacheControl = 'public, max-age=31536000, immutable'
// above the 10 second api timeout, or bun's default of 10 drops the connection before the error page is sent
const idleTimeoutSeconds = 30
const livenessPath = '/health/live'
const servingPath = '/health/serving'
// traefik checks /health/serving every 2 seconds, so it has dropped this container well before the announce ends
const shutdownAnnounceMs = 5_000
// the announce and the drain together must stay under the 20 second stop_grace_period in compose.yml
const shutdownDrainMs = 5_000

function readPort(): number {
  const port = Number(process.env.PORT)

  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('start site server: PORT is not a valid port')

  return port
}

// a fixed list of paths means a request can never reach a file outside dist/client
function listStaticFiles(): Map<string, string> {
  const files = new Map<string, string>()

  for (const file of new Bun.Glob('**/*').scanSync({ cwd: clientRoot })) {
    files.set(`/${file}`, join(clientRoot, file))
  }

  return files
}

// the url keeps a space in a file name as %20, the list holds the name as it is on disk
function decodePath(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return undefined
  }
}

function serveStaticFile(staticFiles: Map<string, string>, request: Request): Response | undefined {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined

  const pathname = decodePath(new URL(request.url).pathname)

  if (pathname === undefined) return undefined

  const filePath = staticFiles.get(pathname)

  if (!filePath) return undefined

  // vite hashes everything under /assets, the rest of public/ keeps its name between releases
  const headers = pathname.startsWith('/assets/') ? { 'cache-control': immutableCacheControl } : undefined

  return new Response(Bun.file(filePath), { headers })
}

// liveness only, so an api outage shows the error page instead of the container dropping out of routing
function answerLiveness(request: Request): Response | undefined {
  if (new URL(request.url).pathname !== livenessPath) return undefined

  return new Response('ok', { headers: { 'cache-control': 'no-store' } })
}

// load balancer membership: traefik stops routing here once this reports draining
function answerServing(request: Request, isDraining: IsDraining): Response | undefined {
  if (new URL(request.url).pathname !== servingPath) return undefined

  const headers = { 'cache-control': 'no-store' }

  if (isDraining()) return Response.json({ status: 'draining' }, { status: 503, headers })

  return Response.json({ status: 'serving' }, { headers })
}

export function createSiteFetch(
  staticFiles: Map<string, string>,
  startServer: StartServer,
  isDraining: IsDraining,
): SiteFetch {
  return (request) =>
    answerLiveness(request) ??
    answerServing(request, isDraining) ??
    serveStaticFile(staticFiles, request) ??
    startServer.fetch(request)
}

async function start(): Promise<void> {
  const port = readPort()
  const staticFiles = listStaticFiles()
  const startServer: StartServer = (await import(join(siteRoot, 'server/server.js'))).default

  let isDraining = false

  const server = Bun.serve({
    hostname: '0.0.0.0',
    port,
    idleTimeout: idleTimeoutSeconds,
    fetch: createSiteFetch(staticFiles, startServer, () => isDraining),
  })

  console.log(`site listening on port ${server.port}`)

  const closeAfterAnnounce = () => {
    // a request that outlives the drain is cut off, so the container never waits for docker's kill
    setTimeout(() => process.exit(0), shutdownDrainMs)

    void server.stop().then(() => process.exit(0))
  }

  // as pid 1 the process ignores SIGTERM unless it handles it
  const stop = () => {
    if (isDraining) return

    isDraining = true
    setTimeout(closeAfterAnnounce, shutdownAnnounceMs)
  }

  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

if (import.meta.main) await start()
