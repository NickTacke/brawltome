import type { ArchitecturePolicy, ArchitectureRepository } from '../src/types'

export const policy: ArchitecturePolicy = {
  roles: {
    '@fixture/api': 'application',
    '@fixture/web': 'application',
    '@fixture/players': 'capability',
    '@fixture/rankings': 'capability',
    '@fixture/contracts': 'contracts',
    '@fixture/game-data': 'foundation',
  },
  allowedExports: {
    '@fixture/api': ['.'],
    '@fixture/web': [],
    '@fixture/players': ['.'],
    '@fixture/rankings': ['.'],
    '@fixture/contracts': ['.'],
    '@fixture/game-data': ['.'],
  },
  capabilityDependencies: {
    '@fixture/players': [],
    '@fixture/rankings': ['@fixture/players'],
  },
  compositionImporters: ['@fixture/api'],
  contractsDependencies: ['@fixture/game-data'],
  localImportAliases: {
    '@fixture/web': ['@/'],
  },
  exceptions: [],
}

const base: ArchitectureRepository = {
  workspaces: [
    {
      name: '@fixture/api',
      path: 'apps/api',
      dependencies: ['@fixture/players'],
      exports: ['.'],
      sourceFiles: [{ path: 'apps/api/src/index.ts', imports: ['@fixture/players'] }],
    },
    {
      name: '@fixture/web',
      path: 'apps/web',
      dependencies: ['@fixture/contracts'],
      exports: [],
      sourceFiles: [{ path: 'apps/web/src/index.ts', imports: ['@fixture/contracts'] }],
    },
    {
      name: '@fixture/players',
      path: 'packages/players',
      dependencies: ['@fixture/game-data'],
      exports: ['.'],
      sourceFiles: [{ path: 'packages/players/src/index.ts', imports: ['@fixture/game-data'] }],
    },
    {
      name: '@fixture/rankings',
      path: 'packages/rankings',
      dependencies: ['@fixture/players'],
      exports: ['.'],
      sourceFiles: [{ path: 'packages/rankings/src/index.ts', imports: ['@fixture/players'] }],
    },
    {
      name: '@fixture/contracts',
      path: 'packages/contracts',
      dependencies: ['@fixture/game-data'],
      exports: ['.'],
      sourceFiles: [{ path: 'packages/contracts/src/index.ts', imports: ['@fixture/game-data'] }],
    },
    {
      name: '@fixture/game-data',
      path: 'packages/game-data',
      dependencies: [],
      exports: ['.'],
      sourceFiles: [{ path: 'packages/game-data/src/index.ts', imports: [] }],
    },
  ],
}

export const validFixture = structuredClone(base)

export function withImport(
  importer: string,
  specifier: string,
  options: { dependency?: string; file?: string } = {},
): ArchitectureRepository {
  const fixture = structuredClone(base)
  const workspace = fixture.workspaces.find(({ name }) => name === importer)
  if (!workspace) throw new Error(`Unknown fixture workspace: ${importer}`)

  workspace.sourceFiles.push({
    path: options.file ?? `${workspace.path}/src/violation.ts`,
    imports: [specifier],
  })
  if (options.dependency && !workspace.dependencies.includes(options.dependency)) {
    workspace.dependencies.push(options.dependency)
  }
  return fixture
}

export function cycleFixture(): ArchitectureRepository {
  const fixture = structuredClone(base)
  const players = fixture.workspaces.find(({ name }) => name === '@fixture/players')
  if (!players) throw new Error('Missing Players fixture')

  players.dependencies.push('@fixture/rankings')
  players.sourceFiles.push({ path: 'packages/players/src/cycle.ts', imports: ['@fixture/rankings'] })
  return fixture
}
