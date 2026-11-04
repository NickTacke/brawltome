import { describe, expect, it } from 'bun:test'
import { checkArchitecture } from '../src/check-architecture'
import { findSchemaReferences } from '../src/sql-references'
import type { TemporaryArchitectureException } from '../src/types'
import { policy, validFixture } from './fixtures'

const schemas = ['accounts', 'players', 'rankings', 'refresh_operations']

describe('findSchemaReferences', () => {
  it('finds schema-qualified names in strings and template literals with source line numbers', () => {
    const source = [
      'const claim = "SELECT refresh_operations.claim_lease($1)"',
      'const aliases = `',
      '  SELECT * FROM players.discovery_aliases',
      '`',
    ].join('\n')

    expect(findSchemaReferences(source, schemas)).toEqual([
      { schema: 'refresh_operations', line: 1 },
      { schema: 'players', line: 3 },
    ])
  })

  it('reads the text parts of a template literal and skips its substitutions', () => {
    const source = [
      'const query = `',
      '  SELECT 1 FROM ${players.length}',
      '  JOIN rankings.entries ON true',
      '`',
    ].join('\n')

    expect(findSchemaReferences(source, schemas)).toEqual([{ schema: 'rankings', line: 3 }])
  })

  it('ignores typescript comments and typescript property access', () => {
    const source = [
      '// players.discovery_aliases',
      '/* rankings.entries',
      '   accounts.sessions */',
      'const count = players.length',
    ].join('\n')

    expect(findSchemaReferences(source, schemas)).toEqual([])
  })

  it('ignores sql comments inside a literal', () => {
    const source = ['const query = `', '  -- players.x', '  /* rankings.y */', '  SELECT 1', '`'].join('\n')

    expect(findSchemaReferences(source, schemas)).toEqual([])
  })

  it('ignores import paths that end in a schema name', () => {
    const source = "import { router } from './players.router'\nexport * from '../mappers/rankings.mapper'"

    expect(findSchemaReferences(source, schemas)).toEqual([])
  })

  it('ignores names that only end in a schema name or follow another dot', () => {
    const source = 'const query = "SELECT x FROM all_players.rows, public.players.id, other_rankings.entries"'

    expect(findSchemaReferences(source, schemas)).toEqual([])
  })
})

describe('cross-module-sql rule', () => {
  const sqlException: TemporaryArchitectureException = {
    id: 'rankings-reads-players-tables',
    rule: 'cross-module-sql',
    importer: '@fixture/rankings',
    dependency: '@fixture/players',
    files: ['packages/rankings/src/leaderboard.ts'],
    importPath: 'players',
    reason: 'Rankings joins the players table.',
    issue: '#1',
    expiresWhen: 'the module is ported (Phase 3)',
  }

  function withRankingsFile(path: string, source: string) {
    const fixture = structuredClone(validFixture)
    const rankings = fixture.workspaces.find(({ name }) => name === '@fixture/rankings')
    if (!rankings) throw new Error('Missing Rankings fixture')
    rankings.sourceFiles.push({ path, imports: [], source })
    return fixture
  }

  const reachingIntoPlayers = 'export const query = "SELECT * FROM players.profiles"'

  it('flags a module that references another module schema once per file and schema', () => {
    const source = 'const a = "players.profiles"\nconst b = "players.names"'
    const fixture = withRankingsFile('packages/rankings/src/leaderboard.ts', source)

    const { violations } = checkArchitecture(fixture, policy)

    expect(violations).toEqual([
      expect.objectContaining({
        rule: 'cross-module-sql',
        importer: '@fixture/rankings',
        dependency: '@fixture/players',
        file: 'packages/rankings/src/leaderboard.ts',
        importPath: 'players',
      }),
    ])
    expect(violations[0]?.message).toContain('lines 1, 2')
  })

  it('allows a module to reference its own schema', () => {
    const fixture = withRankingsFile('packages/rankings/src/leaderboard.ts', 'const a = "rankings.entries"')

    expect(checkArchitecture(fixture, policy).violations).toEqual([])
  })

  it('skips migrations and test files', () => {
    const migration = withRankingsFile('packages/rankings/migrations/0001.ts', reachingIntoPlayers)
    const testFile = withRankingsFile('packages/rankings/tests/leaderboard.test.ts', reachingIntoPlayers)

    expect(checkArchitecture(migration, policy).violations).toEqual([])
    expect(checkArchitecture(testFile, policy).violations).toEqual([])
  })

  it('checks root-level files of a module package', () => {
    const fixture = withRankingsFile('packages/rankings/leaderboard.ts', reachingIntoPlayers)

    expect(checkArchitecture(fixture, policy).violations).toEqual([
      expect.objectContaining({ rule: 'cross-module-sql', file: 'packages/rankings/leaderboard.ts' }),
    ])
  })

  it('does not check workspaces that are not modules', () => {
    const fixture = structuredClone(validFixture)
    const api = fixture.workspaces.find(({ name }) => name === '@fixture/api')
    if (!api) throw new Error('Missing API fixture')
    api.sourceFiles.push({ path: 'apps/api/src/query.ts', imports: [], source: reachingIntoPlayers })

    expect(checkArchitecture(fixture, policy).violations).toEqual([])
  })

  it('passes with a matching exception and reports it as applied', () => {
    const fixture = withRankingsFile('packages/rankings/src/leaderboard.ts', reachingIntoPlayers)

    const result = checkArchitecture(fixture, { ...policy, exceptions: [sqlException] })

    expect(result.violations).toEqual([])
    expect(result.appliedExceptions.map(({ id }) => id)).toEqual([sqlException.id])
    expect(result.staleExceptions).toEqual([])
  })

  it('does not let an exception for one schema cover another', () => {
    const source = `${reachingIntoPlayers}\nconst other = "refresh_operations.claim_lease()"`
    const fixture = withRankingsFile('packages/rankings/src/leaderboard.ts', source)

    const result = checkArchitecture(fixture, { ...policy, exceptions: [sqlException] })

    expect(result.violations).toEqual([
      expect.objectContaining({ rule: 'cross-module-sql', importPath: 'refresh_operations' }),
    ])
  })

  it('reports an exception stale once the reference is gone', () => {
    const fixture = withRankingsFile('packages/rankings/src/leaderboard.ts', 'export const query = "SELECT 1"')

    const result = checkArchitecture(fixture, { ...policy, exceptions: [sqlException] })

    expect(result.staleExceptions.map(({ id }) => id)).toEqual([sqlException.id])
  })
})
