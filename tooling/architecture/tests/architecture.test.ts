import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkArchitecture } from '../src/check-architecture'
import { currentArchitecturePolicy } from '../src/current-policy'
import { readArchitectureRepository } from '../src/read-repository'
import { cycleFixture, policy, validFixture, withImport } from './fixtures'

function rulesFor(repository: Parameters<typeof checkArchitecture>[0]) {
  return checkArchitecture(repository, policy).violations.map(({ rule }) => rule)
}

describe('V3 dependency architecture', () => {
  it('accepts dependencies allowed by workspace roles and capability allow-lists', () => {
    expect(checkArchitecture(validFixture, policy).violations).toEqual([])
  })

  it('rejects app-to-app imports', () => {
    const fixture = withImport('@fixture/web', '@fixture/api', { dependency: '@fixture/api' })

    expect(rulesFor(fixture)).toContain('app-to-app')
  })

  it('rejects package subpaths that are not exported', () => {
    const fixture = withImport('@fixture/web', '@fixture/contracts/internal', { dependency: '@fixture/contracts' })

    expect(rulesFor(fixture)).toContain('deep-import')
  })

  it('rejects relative imports that cross workspace boundaries', () => {
    const fixture = withImport('@fixture/web', '../../../packages/contracts/src/index.ts')

    expect(rulesFor(fixture)).toContain('cross-package-relative-import')
  })

  it('rejects workspace dependency cycles', () => {
    expect(rulesFor(cycleFixture())).toContain('cycle')
  })

  it('rejects imports from undeclared workspace dependencies', () => {
    const fixture = withImport('@fixture/web', '@fixture/players')

    expect(rulesFor(fixture)).toContain('undeclared-dependency')
  })

  it('rejects imports from undeclared third-party dependencies', () => {
    const fixture = withImport('@fixture/web', 'left-pad')

    expect(rulesFor(fixture)).toContain('undeclared-dependency')
  })

  it('rejects capability dependencies missing from the capability allow-list', () => {
    const fixture = withImport('@fixture/players', '@fixture/rankings', { dependency: '@fixture/rankings' })

    expect(rulesFor(fixture)).toContain('capability-allow-list')
  })

  it('rejects unauthorized composition imports and nested composition subpaths', () => {
    const fixture = withImport('@fixture/web', '@fixture/players/composition/internal', {
      dependency: '@fixture/players',
    })
    const players = fixture.workspaces.find(({ name }) => name === '@fixture/players')
    if (!players) throw new Error('Missing Players fixture')
    players.exports.push('./composition/*')

    expect(rulesFor(fixture)).toContain('composition-import')
  })

  it('rejects nested composition imports from otherwise authorized roots', () => {
    const fixture = withImport('@fixture/api', '@fixture/players/composition/internal')
    const players = fixture.workspaces.find(({ name }) => name === '@fixture/players')
    if (!players) throw new Error('Missing Players fixture')
    players.exports.push('./composition/*')

    expect(rulesFor(fixture)).toContain('composition-import')
  })

  it('rejects workspaces without an assigned role', () => {
    const fixture = structuredClone(validFixture)
    fixture.workspaces.push({
      name: '@fixture/unknown',
      path: 'packages/unknown',
      dependencies: [],
      exports: ['.'],
      sourceFiles: [],
    })

    expect(rulesFor(fixture)).toContain('missing-workspace-role')
  })

  it('allows contracts to depend only on configured foundation packages', () => {
    const fixture = withImport('@fixture/contracts', '@fixture/players', { dependency: '@fixture/players' })

    expect(rulesFor(fixture)).toContain('role-dependency')
  })

  it('rejects unapproved package exports', () => {
    const fixture = structuredClone(validFixture)
    const players = fixture.workspaces.find(({ name }) => name === '@fixture/players')
    if (!players) throw new Error('Missing Players fixture')
    players.exports.push('./internal/*')

    expect(rulesFor(fixture)).toContain('package-export')
  })

  it('rejects unresolved and escaping aliases while allowing confined local aliases', () => {
    const unresolved = withImport('@fixture/web', '#players')
    const escaping = withImport('@fixture/web', '@/../../api/src/router')
    const local = withImport('@fixture/web', '@/local-module')

    expect(rulesFor(unresolved)).toContain('unresolved-alias')
    expect(rulesFor(escaping)).toContain('unresolved-alias')
    expect(rulesFor(local)).not.toContain('unresolved-alias')
  })

  it('enforces workspace-specific role restrictions for narrow tooling', () => {
    const fixture = withImport('@fixture/api', '@fixture/game-data', { dependency: '@fixture/game-data' })
    const restrictedPolicy = {
      ...policy,
      workspaceRoleDependencies: { '@fixture/api': ['capability' as const] },
    }

    expect(checkArchitecture(fixture, restrictedPolicy).violations.map(({ rule }) => rule)).toContain('role-dependency')
  })

  it('does not grant legacy workspaces unrestricted dependencies', () => {
    const fixture = withImport('@fixture/players', '@fixture/api', { dependency: '@fixture/api' })
    const legacyPolicy = {
      ...policy,
      roles: { ...policy.roles, '@fixture/players': 'legacy' as const },
    }

    expect(checkArchitecture(fixture, legacyPolicy).violations.map(({ rule }) => rule)).toContain('role-dependency')
  })

  it('rejects forbidden declared dependencies even when source does not import them', () => {
    const fixture = structuredClone(validFixture)
    const web = fixture.workspaces.find(({ name }) => name === '@fixture/web')
    if (!web) throw new Error('Missing Web fixture')
    web.dependencies.push('@fixture/api')

    expect(rulesFor(fixture)).toContain('app-to-app')
  })

  it('reads type-only imports and package exports from a repository', () => {
    const repository = readArchitectureRepository(resolve(import.meta.dir, '../../..'))
    const web = repository.workspaces.find(({ name }) => name === '@brawltome/web')

    expect(web?.sourceFiles.flatMap(({ imports }) => imports)).toContain('@brawltome/api/router')
    expect(repository.workspaces.find(({ name }) => name === '@brawltome/api')?.exports).toContain('./router')
  })

  it('enforces Clans and Players persistence ownership isolation', async () => {
    const root = resolve(import.meta.dir, '../../..')
    const readTree = async (directory: string) => {
      const files: string[] = []
      for await (const file of new Bun.Glob('**/*.ts').scan({ cwd: resolve(root, directory), absolute: true })) {
        files.push(await Bun.file(file).text())
      }
      return files.join('\n')
    }
    const clans = await readTree('packages/contexts/clan')
    const players = await readTree('packages/contexts/player')
    expect(clans).not.toMatch(/@brawltome\/(?:database|player)/)
    expect(players).not.toMatch(/playerClan|getPlayerGuildV1|getGuildStatsV1/)
  })

  it('keeps dead-letter operator tooling capability-owned and behind a narrow composition boundary', () => {
    const repositoryRoot = resolve(import.meta.dir, '../../..')
    const repository = readArchitectureRepository(repositoryRoot)
    const refreshOperations = repository.workspaces.find(({ name }) => name === '@brawltome/refresh-operations')
    const packageDocument = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'packages/contexts/refresh-operations/package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }

    expect(refreshOperations?.sourceFiles.some(({ path }) => path.endsWith('/cli.ts'))).toBe(true)
    expect(refreshOperations?.exports.sort()).toEqual(['.', './composition'])
    expect(packageDocument.scripts?.['dead-letters']).toBe('bun cli.ts')
  })

  it('passes the current repository only through the exact temporary V2 exceptions', () => {
    const repository = readArchitectureRepository(resolve(import.meta.dir, '../../..'))
    const result = checkArchitecture(repository, currentArchitecturePolicy)

    expect(result.violations).toEqual([])
    expect(result.staleExceptions).toEqual([])
    expect(result.appliedExceptions.map(({ id }) => id).sort()).toEqual(
      [
        'v2-api-matchmaking-package',
        'v2-api-replay-package',
        'v2-api-router-export',
        'v2-api-shared-package',
        'v2-discord-api-router-app-import',
        'v2-discord-api-router-undeclared',
        'v2-matchmaking-database-adapter',
        'v2-matchmaking-replay-package',
        'v2-player-bhapi-adapter',
        'v2-player-compatibility-export',
        'v2-player-database-adapter',
        'v2-player-shared-package',
        'v2-shared-bhapi-adapter',
        'v2-shared-database-adapter',
        'v2-shared-game-data-foundation',
        'v2-web-api-router-client-app-import',
        'v2-web-api-router-client-undeclared',
        'v2-web-api-router-server-app-import',
        'v2-web-api-router-server-undeclared',
      ].sort(),
    )
  })

  it('reports named temporary exceptions without allowing new import locations', () => {
    const fixture = withImport('@fixture/web', '@fixture/api', { dependency: '@fixture/api' })
    const resultPolicy = {
      ...policy,
      exceptions: [
        {
          id: 'v2-web-imports-api-router',
          rule: 'app-to-app' as const,
          importer: '@fixture/web',
          dependency: '@fixture/api',
          files: ['apps/web/package.json', 'apps/web/src/violation.ts'] as [string, ...string[]],
          reason: 'V2 clients still consume the API router type.',
          issue: '#186',
          expiresWhen: 'The transport contracts package owns AppRouter.',
        },
      ],
    }
    const result = checkArchitecture(fixture, resultPolicy)

    expect(result.violations).toEqual([])
    expect(result.appliedExceptions.map(({ id }) => id)).toEqual(['v2-web-imports-api-router'])

    const driftedFixture = withImport('@fixture/web', '@fixture/api', {
      dependency: '@fixture/api',
      file: 'apps/web/src/new-api-import.ts',
    })
    expect(checkArchitecture(driftedFixture, resultPolicy).violations.map(({ rule }) => rule)).toContain('app-to-app')
  })

  it('rejects unscoped exceptions and reports partially stale file scopes', () => {
    const fixture = withImport('@fixture/web', '@fixture/api', { dependency: '@fixture/api' })
    const exception = {
      id: 'v2-web-imports-api-router',
      rule: 'app-to-app' as const,
      importer: '@fixture/web',
      dependency: '@fixture/api',
      files: ['apps/web/package.json', 'apps/web/src/violation.ts', 'apps/web/src/removed.ts'] as [string, ...string[]],
      reason: 'V2 clients still consume the API router type.',
      issue: '#186',
      expiresWhen: 'The transport contracts package owns AppRouter.',
    }
    const partial = checkArchitecture(fixture, { ...policy, exceptions: [exception] })
    const unscoped = checkArchitecture(fixture, {
      ...policy,
      exceptions: [{ ...exception, files: undefined } as never],
    })

    expect(partial.staleExceptions.map(({ id }) => id)).toEqual([exception.id])
    expect(unscoped.violations.map(({ rule }) => rule)).toContain('app-to-app')
  })
})
