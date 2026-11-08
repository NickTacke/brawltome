import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createDeadLetterHooks } from '../src/dead-letter-hooks'

const repositoryRoot = resolve(import.meta.dir, '../../..')

// the workspace files an entry reaches, following relative and @brawltome imports only
function workspaceImports(entry: string): Set<string> {
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  const seen = new Set<string>()
  const pending = [entry]

  while (pending.length > 0) {
    const file = pending.pop() as string

    if (seen.has(file)) continue

    seen.add(file)

    for (const { path, kind } of transpiler.scanImports(readFileSync(file, 'utf8'))) {
      if (kind !== 'import-statement') continue

      if (!path.startsWith('.') && !path.startsWith('@brawltome/')) continue

      const resolved = Bun.resolveSync(path, dirname(file))

      if (!resolved.includes('/node_modules/') && resolved.endsWith('.ts')) pending.push(resolved)
    }
  }

  return seen
}

describe('dead letter hooks', () => {
  test('lists effects for every kind that writes them, and only those', () => {
    const { describeEffects } = createDeadLetterHooks()

    expect([...describeEffects.keys()].sort()).toEqual([
      'clan-refresh',
      'interactive-player-refresh',
      'leaderboard-1v1',
      'leaderboard-2v2',
      'leaderboard-3v3',
      'leaderboard-solo-2v2',
      'player-name-verification',
      'primary-player-verification',
      'proof',
      'ranked-player-pulse',
      'statistics-legend-meta-publication',
      'statistics-lifetime-collection',
      'statistics-publication',
      'statistics-ranked-collection',
    ])
  })

  test('guards only the statistics collection kinds', () => {
    const { replayGuards } = createDeadLetterHooks()

    expect([...replayGuards.keys()].sort()).toEqual(['statistics-lifetime-collection', 'statistics-ranked-collection'])
  })

  test('the operator entry stays clear of the API server and the owner package roots', () => {
    const files = workspaceImports(resolve(repositoryRoot, 'apps/api/src/dead-letter-cli.ts'))
    const reached = [...files].map((file) => file.replace(`${repositoryRoot}/`, ''))

    const appFiles = reached.filter((file) => file.startsWith('apps/')).sort()

    expect(appFiles).toEqual(['apps/api/src/dead-letter-cli.ts', 'apps/api/src/dead-letter-hooks.ts'])

    const ownerRoots = ['accounts', 'clan', 'discovery', 'player', 'ranking', 'replay-analysis', 'statistics'].map(
      (owner) => `packages/modules/${owner}/index.ts`,
    )

    expect(reached.filter((file) => ownerRoots.includes(file))).toEqual([])
    expect(reached.filter((file) => file.startsWith('packages/bhapi/'))).toEqual([])
  })
})
