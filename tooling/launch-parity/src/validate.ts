import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import type { ParityEvidence, ParityRow } from './schema'

const executableEvidence = new Set(['unit', 'integration', 'browser'])
const requiredRowIds = [
  'shell.desktop-rail',
  'shell.mobile-menu',
  'shell.home-public-search',
  'shell.home-leaderboard-discovery',
  'placeholder.matches',
  'placeholder.learn',
  'placeholder.tournaments',
  'placeholder.feed',
  'route.home',
  'route.player-id',
  'route.clan-id',
  'route.account',
  'route.stats',
  'operations.dead-letters',
  'operations.observability',
  'refresh.interactive-player',
  'player.current-season-ranked',
  'player.canonical-profile',
  'statistics.eu-diamond-cohort-tracer',
  'discord.player-command',
  'discord.clan-command',
  'discord.status-command',
  'discord.lifecycle-expiry',
  'discord.smoke-procedures',
  'statistics.full-launch-cohort-validation',
] as const
const requiredShellDestinations = new Map([
  ['/', 'live'],
  ['/stats', 'soon'],
  ['/matches', 'soon'],
  ['/learn', 'soon'],
  ['/tournaments', 'soon'],
  ['/feed', 'soon'],
])
const preservedRoutes = new Map([
  ['route.home', { destination: '/', page: 'apps/web/src/app/page.tsx' }],
  ['route.player-id', { destination: '/player/:id', page: 'apps/web/src/app/player/[id]/page.tsx' }],
  ['route.clan-id', { destination: '/clan/:id', page: 'apps/web/src/app/clan/[id]/page.tsx' }],
  ['route.account', { destination: '/account', page: 'apps/web/src/app/account/page.tsx' }],
  ['route.stats', { destination: '/stats', page: 'apps/web/src/app/stats/page.tsx' }],
])

type NavigationDestination = {
  label: string
  href: string
  status: string
}

type PreservedRouteFixture = {
  rowId: string
  destination: string
  page: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validatePath(rowId: string, kind: string, path: string, repositoryRoot: string): string[] {
  const resolvedRoot = resolve(repositoryRoot)
  const resolvedPath = resolve(resolvedRoot, path)
  const traverses = path.split(/[\\/]/).includes('..')
  if (
    isAbsolute(path) ||
    traverses ||
    (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`))
  ) {
    return [`${rowId} ${kind} path must stay inside the repository: ${path}`]
  }
  if (!existsSync(resolvedPath)) return [`${rowId} ${kind} path does not exist: ${path}`]

  const canonicalRoot = realpathSync(resolvedRoot)
  const canonicalPath = realpathSync(resolvedPath)
  if (canonicalPath !== canonicalRoot && !canonicalPath.startsWith(`${canonicalRoot}${sep}`)) {
    return [`${rowId} ${kind} path escapes the repository through a symlink: ${path}`]
  }
  return []
}

export function evidenceCommand(evidence: ParityEvidence): string[] | null {
  if (evidence.kind === 'unit' || evidence.kind === 'integration') return ['bun', 'test', evidence.path]
  if (evidence.kind === 'browser') {
    return ['bun', 'run', '--filter', '@brawltome/web', 'test:browser', '--', evidence.path]
  }
  return null
}

export function validateLaunchParity(rows: readonly ParityRow[], repositoryRoot: string, now = new Date()): string[] {
  const errors: string[] = []
  const seenIds = new Set<string>()

  for (const row of rows) {
    if (seenIds.has(row.id)) errors.push(`duplicate parity row id: ${row.id}`)
    seenIds.add(row.id)

    for (const path of row.implementation) errors.push(...validatePath(row.id, 'implementation', path, repositoryRoot))
    for (const evidence of row.evidence) {
      errors.push(...validatePath(row.id, 'evidence', evidence.path, repositoryRoot))
      if (executableEvidence.has(evidence.kind) && !/(^|\/)(tests?\/|[^/]+\.(test|spec)\.)/.test(evidence.path)) {
        errors.push(`${row.id} executable evidence must reference a test: ${evidence.path}`)
      }
    }

    if (row.status === 'planned' && !row.blocker) errors.push(`${row.id} planned rows require a blocker`)
    if (row.status === 'implemented') {
      if (row.implementation.length === 0) errors.push(`${row.id} implemented rows require implementation paths`)
      if (!row.verificationGap) errors.push(`${row.id} implemented rows require a verification gap`)
    }
    if (row.status === 'verified' && !row.evidence.some((evidence) => evidenceCommand(evidence))) {
      errors.push(`${row.id} verified rows require executable evidence`)
    }
    if (row.status === 'waived') {
      if (!row.waiver?.owner || !row.waiver.reason) errors.push(`${row.id} waived rows require an owner and reason`)
      const expiration = row.waiver ? new Date(row.waiver.expires) : undefined
      if (!expiration || Number.isNaN(expiration.valueOf())) {
        errors.push(`${row.id} waivers require a valid expiration`)
      } else if (expiration <= now) {
        errors.push(`${row.id} waiver expired on ${row.waiver?.expires}`)
      }
    }
  }

  return errors
}

function readNavigation(repositoryRoot: string): { destinations: NavigationDestination[]; errors: string[] } {
  const path = resolve(repositoryRoot, 'apps/web/src/components/sidebar/navigation.json')
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { destinations: [], errors: ['shell navigation contract must contain valid JSON'] }
  }
  if (!Array.isArray(value)) return { destinations: [], errors: ['shell navigation contract must be an array'] }

  const destinations: NavigationDestination[] = []
  const errors: string[] = []
  for (const [index, item] of value.entries()) {
    if (
      !isRecord(item) ||
      typeof item.label !== 'string' ||
      typeof item.href !== 'string' ||
      typeof item.status !== 'string'
    ) {
      errors.push(`invalid shell destination at index ${index}`)
      continue
    }
    destinations.push({ label: item.label, href: item.href, status: item.status })
  }
  return { destinations, errors }
}

function readPreservedRoutes(repositoryRoot: string): { fixtures: PreservedRouteFixture[]; errors: string[] } {
  const path = resolve(repositoryRoot, 'apps/web/tests/fixtures/preserved-public-routes.json')
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { fixtures: [], errors: ['preserved public route fixture must contain valid JSON'] }
  }
  if (!Array.isArray(value)) return { fixtures: [], errors: ['preserved public route fixture must be an array'] }

  const fixtures: PreservedRouteFixture[] = []
  const errors: string[] = []
  for (const [index, item] of value.entries()) {
    if (
      !isRecord(item) ||
      typeof item.rowId !== 'string' ||
      typeof item.destination !== 'string' ||
      typeof item.page !== 'string'
    ) {
      errors.push(`invalid preserved public route fixture at index ${index}`)
      continue
    }
    fixtures.push({ rowId: item.rowId, destination: item.destination, page: item.page })
  }
  return { fixtures, errors }
}

export function validateRepositoryParity(rows: readonly ParityRow[], repositoryRoot: string): string[] {
  const errors = validateLaunchParity(rows, repositoryRoot)
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const id of requiredRowIds) {
    if (!byId.has(id)) errors.push(`required parity row is missing: ${id}`)
  }

  const navigationResult = readNavigation(repositoryRoot)
  errors.push(...navigationResult.errors)
  const navigationByHref = new Map<string, NavigationDestination>()
  for (const destination of navigationResult.destinations) {
    if (navigationByHref.has(destination.href)) errors.push(`duplicate shell destination: ${destination.href}`)
    navigationByHref.set(destination.href, destination)
  }
  for (const [href, status] of requiredShellDestinations) {
    const destination = navigationByHref.get(href)
    if (!destination?.label || destination.status !== status) {
      errors.push(`${href} must be a ${status} shell destination`)
    }
  }
  for (const href of navigationByHref.keys()) {
    if (!requiredShellDestinations.has(href)) errors.push(`unknown shell destination: ${href}`)
  }

  for (const href of ['/matches', '/learn', '/tournaments', '/feed']) {
    const row = byId.get(`placeholder.${href.slice(1)}`)
    if (!row?.destinations.includes(href)) errors.push(`placeholder parity row does not cover ${href}`)
  }

  const fixtureResult = readPreservedRoutes(repositoryRoot)
  errors.push(...fixtureResult.errors)
  const fixturesById = new Map(fixtureResult.fixtures.map((fixture) => [fixture.rowId, fixture]))
  if (fixturesById.size !== fixtureResult.fixtures.length)
    errors.push('preserved public route fixture IDs must be unique')
  for (const [rowId, expected] of preservedRoutes) {
    const fixture = fixturesById.get(rowId)
    if (fixture?.destination !== expected.destination || fixture.page !== expected.page) {
      errors.push(`${rowId} preserved route fixture does not match ${expected.destination}`)
    }
    const row = byId.get(rowId)
    if (
      row?.destinations.length !== 1 ||
      row.destinations[0] !== expected.destination ||
      !row.implementation.includes(expected.page)
    ) {
      errors.push(`${rowId} parity row does not match its preserved route fixture`)
    }
  }
  for (const fixture of fixtureResult.fixtures) {
    if (!preservedRoutes.has(fixture.rowId)) errors.push(`unknown preserved public route fixture: ${fixture.rowId}`)
  }

  return errors
}
