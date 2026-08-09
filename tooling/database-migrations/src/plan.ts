import { createHash } from 'node:crypto'

export type Migration = {
  identity: string
  predecessor: string | null
  checksum: string
  sql: string
}

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
  const ordered = [...migrations]
  validateInventory(ordered)

  for (const [index, recorded] of applied.entries()) {
    const expected = ordered[index]
    if (!expected || recorded.identity !== expected.identity) {
      throw new Error(
        `applied migration ${recorded.identity} does not match expected prefix ${expected?.identity ?? '<end>'}`,
      )
    }
    if (recorded.checksum !== expected.checksum) {
      throw new Error(`checksum mismatch for applied migration ${recorded.identity}`)
    }
  }

  return {
    pending: ordered.slice(applied.length),
  }
}

function validateInventory(migrations: Migration[]): void {
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

  const latestByCapability = new Map<string, string>()
  for (const migration of migrations) {
    if (migration.predecessor && !identities.has(migration.predecessor)) {
      throw new Error(`missing predecessor ${migration.predecessor} for ${migration.identity}`)
    }

    const capability = migration.identity.split('/')[0]
    const expectedPredecessor = latestByCapability.get(capability) ?? null
    if (migration.predecessor !== expectedPredecessor) {
      throw new Error(
        `predecessor ${migration.predecessor ?? '<none>'} for ${migration.identity} does not match owner-local order ${expectedPredecessor ?? '<start>'}`,
      )
    }
    latestByCapability.set(capability, migration.identity)
  }
}
