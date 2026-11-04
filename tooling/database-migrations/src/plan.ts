import { createHash } from 'node:crypto'
import type { Migration } from '@brawltome/foundation'
import { dependenciesOf, isDeployed, orderMigrations } from './order'

export type AppliedMigration = {
  identity: string
  checksum: string
}

export type MigrationPlan = {
  pending: Migration[]
}

export function checksumSql(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

export function buildMigrationPlan(
  migrations: readonly Migration[],
  applied: readonly AppliedMigration[],
): MigrationPlan {
  validateMigrations(migrations)

  const ordered = orderMigrations(migrations)
  validateOwnerChains(ordered)
  validateAppliedHistory(ordered, applied)

  const appliedIdentities = new Set(applied.map(({ identity }) => identity))

  return {
    pending: ordered.filter(({ identity }) => !appliedIdentities.has(identity)),
  }
}

function validateMigrations(migrations: readonly Migration[]): void {
  const identities = new Set<string>()
  for (const migration of migrations) {
    if (!/^[a-z][a-z0-9-]*\/\d{4}$/.test(migration.identity)) {
      throw new Error(`invalid migration identity ${migration.identity}`)
    }
    if (identities.has(migration.identity)) {
      throw new Error(`duplicate migration identity ${migration.identity}`)
    }
    identities.add(migration.identity)

    if (checksumSql(migration.sql) !== migration.checksum) {
      throw new Error(`declared checksum does not match SQL for ${migration.identity}`)
    }
  }
}

function validateOwnerChains(ordered: readonly Migration[]): void {
  const latestByOwner = new Map<string, string>()

  for (const migration of ordered) {
    const owner = migration.identity.split('/')[0]
    const expectedPredecessor = latestByOwner.get(owner) ?? null
    if (migration.predecessor !== expectedPredecessor) {
      throw new Error(
        `predecessor ${migration.predecessor ?? '<none>'} for ${migration.identity} does not match owner-local order ${expectedPredecessor ?? '<start>'}`,
      )
    }

    latestByOwner.set(owner, migration.identity)
  }
}

// a migration added later can sort before ones already applied, so past the deployed prefix the
// history only has to respect dependencies, not the order this release would pick
function validateAppliedHistory(ordered: readonly Migration[], applied: readonly AppliedMigration[]): void {
  const byIdentity = new Map(ordered.map((migration) => [migration.identity, migration]))
  const appliedBefore = new Set<string>()

  for (const recorded of applied) {
    const migration = byIdentity.get(recorded.identity)
    if (!migration) {
      throw new Error(`applied migration ${recorded.identity} is not in the modules`)
    }
    if (recorded.checksum !== migration.checksum) {
      throw new Error(`checksum mismatch for applied migration ${recorded.identity}`)
    }

    const missingDependency = dependenciesOf(migration).find((identity) => !appliedBefore.has(identity))
    if (missingDependency) {
      throw new Error(
        `applied migration ${recorded.identity} depends on ${missingDependency}, which was not applied before it`,
      )
    }

    appliedBefore.add(recorded.identity)
  }

  validateDeployedPrefix(ordered, applied)
}

// ordered starts with the deployed migrations, so applied deployed rows must match it row for row
function validateDeployedPrefix(ordered: readonly Migration[], applied: readonly AppliedMigration[]): void {
  const appliedDeployedCount = applied.filter(({ identity }) => isDeployed(identity)).length

  for (const [index, recorded] of applied.slice(0, appliedDeployedCount).entries()) {
    const expected = ordered[index]
    if (recorded.identity !== expected.identity) {
      throw new Error(`applied migration ${recorded.identity} breaks the deployed order, expected ${expected.identity}`)
    }
  }
}
