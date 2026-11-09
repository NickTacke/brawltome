// Serves the built site. The TanStack Start build only exports a fetch handler, so something has to listen on the port
// and answer for the files in dist/client.
import { join, resolve } from 'node:path'

type SiteFetch = (request: Request) => Response | Promise<Response>
type StartServer = { fetch: SiteFetch }

const siteRoot = resolve(import.meta.dir, '../../apps/site/dist')
const clientRoot = join(siteRoot, 'client')
const immutableCacheControl = 'public, max-age=31536000, immutable'
// above the 10 second api timeout, or bun's default of 10 drops the connection before the error page is sent
const idleTimeoutSeconds = 30
const livenessPath = '/health/live'

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

function serveStaticFile(staticFiles: Map<string, string>, request: Request): Response | undefined {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined

  const { pathname } = new URL(request.url)
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

export function createSiteFetch(staticFiles: Map<string, string>, startServer: StartServer): SiteFetch {
  return (request) => answerLiveness(request) ?? serveStaticFile(staticFiles, request) ?? startServer.fetch(request)
}

async function start(): Promise<void> {
  const port = readPort()
  const staticFiles = listStaticFiles()
  const startServer: StartServer = (await import(join(siteRoot, 'server/server.js'))).default

  const server = Bun.serve({
    hostname: '0.0.0.0',
    port,
    idleTimeout: idleTimeoutSeconds,
    fetch: createSiteFetch(staticFiles, startServer),
  })

  console.log(`site listening on port ${server.port}`)

  // as pid 1 the process ignores SIGTERM unless it handles it
  const stop = () => {
    void server.stop().then(() => process.exit(0))
  }

  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

if (import.meta.main) await start()
