// Starts the Next.js standalone server with a drain phase for zero-downtime deploys (see infra/app/deploy.sh).
// Next exits as soon as it receives SIGTERM. Instead, /api/health/serving reports draining while the server keeps
// answering, so Traefik's health check moves traffic to the replacement; the process exits once in-flight requests
// have had time to finish.
'use strict'

const path = require('node:path')

function milliseconds(name, fallback) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name])
  if (!Number.isInteger(value) || value < 0 || value > 60_000) {
    throw new Error(`${name} must be an integer from 0 through 60000`)
  }
  return value
}

const announceMs = milliseconds('SHUTDOWN_ANNOUNCE_MS', 5_000)
const drainMs = milliseconds('SHUTDOWN_DRAIN_MS', 5_000)
const drainingKey = Symbol.for('brawltome.web.draining')

process.env.NEXT_MANUAL_SIG_HANDLE = 'true'
globalThis[drainingKey] = false

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  globalThis[drainingKey] = true
  setTimeout(() => process.exit(0), announceMs + drainMs)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

require(path.join(__dirname, '..', '..', 'apps', 'web', 'server.js'))
