import type { AppStatus } from './app-status'

export type StatusTone = 'ok' | 'warn' | 'idle' | 'info'

export type StatusLine = { tone: StatusTone; text: string; detail: string | null; action: 'resume' | null }

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// one line for the game, then one more for each thing that needs the player's attention
export function statusLines(status: AppStatus): StatusLine[] {
  const lines = [gameLine(status)]
  const serviceLine = serviceTrouble(status)
  const updateLine = updateNote(status)

  if (serviceLine !== null) lines.push(serviceLine)

  if (updateLine !== null) lines.push(updateLine)

  if (status.isOverlayPaused) lines.push({ tone: 'warn', text: 'Overlay paused', detail: null, action: 'resume' })

  return lines
}

function gameLine({ game, detection }: AppStatus): StatusLine {
  if (game.state === 'notRunning') return line('idle', "Brawlhalla isn't running")

  if (detection.state === 'unsupported') return line('warn', detection.message)

  if (detection.state !== 'ready') return line('idle', 'Connecting to Brawlhalla')

  const version = shortGameVersion(game.gameVersion)

  return line('ok', 'Ready', version === null ? null : `Brawlhalla ${version}`)
}

function serviceTrouble({ service, game }: AppStatus): StatusLine | null {
  if (service.state === 'offline') return line('warn', 'No connection to BrawlTome', 'game data only')

  if (service.state === 'unavailable') return line('warn', 'BrawlTome is down')

  if (service.state !== 'updateRequired') return null

  // the update only installs while the game is closed
  const detail = game.state === 'running' ? 'close Brawlhalla to update' : null

  return line('warn', 'Update required', detail)
}

function updateNote({ update }: AppStatus): StatusLine | null {
  if (update.state === 'downloading') return line('info', `Updating to ${update.version}`)

  if (update.state === 'readyWhenGameCloses') {
    return line('info', `Update ${update.version} installs when Brawlhalla closes`)
  }

  return null
}

function line(tone: StatusTone, text: string, detail: string | null = null): StatusLine {
  return { tone, text, detail, action: null }
}

// '11.00.36258' -> '11.00', the patch the game shows
export function shortGameVersion(gameVersion: string | null): string | null {
  if (gameVersion === null || gameVersion === '') return null

  return gameVersion.split('.').slice(0, 2).join('.')
}

// 'now', '12m', '2h', '1d'
export function timeAgo(startedAtMs: number, nowMs: number): string {
  const agoMs = Math.max(0, nowMs - startedAtMs)

  if (agoMs < MINUTE_MS) return 'now'

  if (agoMs < HOUR_MS) return `${Math.floor(agoMs / MINUTE_MS)}m`

  if (agoMs < DAY_MS) return `${Math.floor(agoMs / HOUR_MS)}h`

  return `${Math.floor(agoMs / DAY_MS)}d`
}
