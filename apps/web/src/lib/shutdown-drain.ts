// infra/app/web-server.cjs sets this flag on SIGTERM. A global symbol reaches the bundled route handlers without an
// import, because the launcher runs outside the Next.js bundle.
const drainingKey = Symbol.for('brawltome.web.draining')

export function isDraining(): boolean {
  return (globalThis as Record<symbol, unknown>)[drainingKey] === true
}
