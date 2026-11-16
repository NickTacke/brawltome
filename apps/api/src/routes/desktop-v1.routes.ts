import {
  type DesktopLobbyContract,
  type DesktopLobbyInputContract,
  desktopLobbyInputSchema,
} from '@brawltome/contracts'
import type { Telemetry } from '@brawltome/telemetry'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { readClientIp } from '../client-ip'
import type { DesktopVersion } from '../desktop/desktop-version'
import { buildLobbyCards } from '../desktop/lobby-cards'
import { type LobbyReads, readStoredLobby, type StoredLobby } from '../desktop/read-lobby'
import { type DesktopRefresher, opponentRefreshMaxUsageRatio } from '../desktop/request-refresh'
import { type DesktopVariables, requireDesktopVersion } from '../desktop/require-desktop-version'
import type { StoredPlayer } from '../desktop/stored-player'
import type { VisitLimiter } from '../visits'

// far more than one app loads matches, so only a retry loop or many players behind one address reach it
export const lobbiesPerMinute = 30

// a full lobby is well under 1 KiB, and without a limit Bun would buffer up to 128 MB before the schema refuses it
const maxLobbyBodyBytes = 8 * 1024

export type DesktopV1RouteDependencies = {
  minimumVersion: DesktopVersion
  lobbyReads: LobbyReads
  refresher: DesktopRefresher
  lobbyLimiter: VisitLimiter
  telemetry: Pick<Telemetry, 'metrics' | 'logger'>
}

type DesktopEnvironment = { Variables: DesktopVariables }
type LobbyOutcome = 'ok' | 'update_required' | 'rate_limited' | 'invalid' | 'failed'

const outcomesByStatus = new Map<number, LobbyOutcome>([
  [200, 'ok'],
  [426, 'update_required'],
  [429, 'rate_limited'],
  [400, 'invalid'],
])

function observeLobby(telemetry: DesktopV1RouteDependencies['telemetry']): MiddlewareHandler<DesktopEnvironment> {
  return async (context, next) => {
    const startedMs = performance.now()
    // stays 500 when a later handler throws instead of answering
    let status = 500

    try {
      await next()
      status = context.res.status
    } finally {
      const outcome = outcomesByStatus.get(status) ?? 'failed'

      telemetry.metrics.add('desktop_requests_total', 1, { endpoint: 'lobby', outcome })
      telemetry.metrics.observe('desktop_request_duration_ms', performance.now() - startedMs, { endpoint: 'lobby' })
    }
  }
}

function limitByAddress(limiter: VisitLimiter): MiddlewareHandler<DesktopEnvironment> {
  return async (context, next) => {
    const clientIp = readClientIp(context.req.raw.headers)

    if (!limiter.allow(clientIp)) {
      context.header('retry-after', '60')

      return context.json({ error: 'rate_limited' }, 429)
    }

    await next()
  }
}

async function readLobbyInput(context: Context<DesktopEnvironment>): Promise<DesktopLobbyInputContract | null> {
  let body: unknown

  try {
    body = await context.req.json()
  } catch {
    return null
  }

  const checked = desktopLobbyInputSchema.safeParse(body)

  if (!checked.success) return null

  return checked.data
}

// ids of the players whose refresh was requested; none while the V0 budget is closed
async function requestRefreshes(
  refresher: DesktopRefresher,
  players: StoredPlayer[],
  clientIp: string,
): Promise<Set<number>> {
  const stalePlayers = players.filter((player) => player.isStale)

  if (stalePlayers.length === 0) return new Set()

  const isBudgetOpen = await refresher.isBudgetOpen(opponentRefreshMaxUsageRatio)

  if (!isBudgetOpen) return new Set()

  const states = await Promise.all(
    stalePlayers.map((player) =>
      refresher.request({ brawlhallaId: player.brawlhallaId, lastSuccessAt: player.lastSuccessAt, clientIp }),
    ),
  )

  const requestedPlayers = stalePlayers.filter((_player, index) => states[index].state === 'requested')

  return new Set(requestedPlayers.map((player) => player.brawlhallaId))
}

function markRefreshing(lobby: DesktopLobbyContract, refreshingIds: Set<number>): DesktopLobbyContract {
  const cards = lobby.cards.map((card) => {
    const players = card.players.map((player) => ({ ...player, isRefreshing: refreshingIds.has(player.brawlhallaId) }))

    return { ...card, players }
  })

  return { cards }
}

// counts only: the log names no player and no address
function recordLobby(
  telemetry: DesktopV1RouteDependencies['telemetry'],
  version: string,
  input: DesktopLobbyInputContract,
  stored: StoredLobby,
  refreshes: number,
): void {
  for (const player of stored.players) {
    telemetry.metrics.add('desktop_lobby_cards_total', 1, { match_type: input.matchType, source: player.source })
  }

  const misses = stored.players.filter((player) => player.source === 'none').length

  telemetry.logger.info('desktop.lobby.answered', {
    version,
    matchType: input.matchType,
    players: stored.players.length,
    misses,
    refreshes,
  })
}

async function answerLobby(dependencies: DesktopV1RouteDependencies, context: Context<DesktopEnvironment>) {
  const input = await readLobbyInput(context)

  if (!input) return context.json({ error: 'invalid_request' }, 400)

  let stored: StoredLobby

  try {
    stored = await readStoredLobby(dependencies.lobbyReads, input)
  } catch (error) {
    dependencies.telemetry.logger.error('desktop.lobby.failed', error)
    context.header('retry-after', '5')

    return context.json({ error: 'temporarily_unavailable' }, 503)
  }

  const lobby = buildLobbyCards(input, stored)
  const clientIp = readClientIp(context.req.raw.headers)
  const refreshingIds = await requestRefreshes(dependencies.refresher, stored.players, clientIp)

  recordLobby(dependencies.telemetry, context.get('desktopVersion'), input, stored, refreshingIds.size)

  return context.json(markRefreshing(lobby, refreshingIds))
}

export function createDesktopV1Routes(dependencies: DesktopV1RouteDependencies): Hono<DesktopEnvironment> {
  const routes = new Hono<DesktopEnvironment>()

  routes.post(
    '/lobby',
    observeLobby(dependencies.telemetry),
    requireDesktopVersion(dependencies.minimumVersion),
    limitByAddress(dependencies.lobbyLimiter),
    bodyLimit({ maxSize: maxLobbyBodyBytes, onError: (context) => context.json({ error: 'invalid_request' }, 400) }),
    (context) => answerLobby(dependencies, context),
  )

  return routes
}
