import type { Migration } from '@brawltome/foundation'
import { deployedOrder } from './deployed-order'

const deployedIdentities = new Set(deployedOrder)

export function isDeployed(identity: string): boolean {
  return deployedIdentities.has(identity)
}

// ties are broken by identity so the order never depends on how the modules list their migrations
export function orderMigrations(migrations: readonly Migration[]): Migration[] {
  validateDependencies(migrations)

  const deployed = orderDeployed(migrations)
  const placed = new Set(deployed.map(({ identity }) => identity))
  const undeployed = migrations.filter(({ identity }) => !isDeployed(identity))

  return [...deployed, ...orderByDependencies(undeployed, placed)]
}

export function checkDeployedMigrationsPresent(migrations: readonly Migration[]): void {
  const identities = new Set(migrations.map(({ identity }) => identity))

  for (const identity of deployedOrder) {
    if (!identities.has(identity)) {
      throw new Error(`deployed migration ${identity} is missing from the modules`)
    }
  }
}

export function dependenciesOf(migration: Migration): string[] {
  const requirements = migration.requires ?? []

  return migration.predecessor ? [migration.predecessor, ...requirements] : [...requirements]
}

function validateDependencies(migrations: readonly Migration[]): void {
  const identities = new Set<string>()
  for (const { identity } of migrations) {
    if (identities.has(identity)) {
      throw new Error(`duplicate migration identity ${identity}`)
    }
    identities.add(identity)
  }

  for (const migration of migrations) {
    if (migration.predecessor && !identities.has(migration.predecessor)) {
      throw new Error(`missing predecessor ${migration.predecessor} for ${migration.identity}`)
    }

    const unknownRequirement = migration.requires?.find((identity) => !identities.has(identity))
    if (unknownRequirement) {
      throw new Error(`unknown requirement ${unknownRequirement} for ${migration.identity}`)
    }
  }
}

function orderDeployed(migrations: readonly Migration[]): Migration[] {
  const byIdentity = new Map(migrations.map((migration) => [migration.identity, migration]))
  const presentIdentities = deployedOrder.filter((identity) => byIdentity.has(identity))
  const present = presentIdentities.map((identity) => byIdentity.get(identity) as Migration)
  const placed = new Set<string>()

  for (const migration of present) {
    const laterDependency = dependenciesOf(migration).find((identity) => !placed.has(identity))
    if (laterDependency) {
      throw new Error(
        `deployed migration ${migration.identity} cannot depend on ${laterDependency}, which does not come before it in the deployed order`,
      )
    }

    placed.add(migration.identity)
  }

  return present
}

// kahn's algorithm, always taking the alphabetically first ready migration
function orderByDependencies(migrations: readonly Migration[], placed: ReadonlySet<string>): Migration[] {
  const remaining = new Map(migrations.map((migration) => [migration.identity, migration]))
  const done = new Set(placed)
  const ordered: Migration[] = []

  while (remaining.size > 0) {
    const ready = readyIdentities(remaining, done)
    if (ready.length === 0) {
      throw new Error(`migrations depend on each other in a cycle: ${findCycle(remaining).join(' -> ')}`)
    }

    const next = remaining.get(ready[0]) as Migration
    ordered.push(next)
    done.add(next.identity)
    remaining.delete(next.identity)
  }

  return ordered
}

function readyIdentities(remaining: ReadonlyMap<string, Migration>, done: ReadonlySet<string>): string[] {
  const ready = [...remaining.values()].filter((migration) =>
    dependenciesOf(migration).every((identity) => done.has(identity)),
  )

  return ready.map(({ identity }) => identity).sort()
}

// every remaining migration waits on another remaining one, so following those waits must loop
function findCycle(remaining: ReadonlyMap<string, Migration>): string[] {
  const path: string[] = []
  let current = [...remaining.keys()].sort()[0]

  while (!path.includes(current)) {
    path.push(current)
    const waitingOn = dependenciesOf(remaining.get(current) as Migration).filter((identity) => remaining.has(identity))
    current = waitingOn.sort()[0]
  }

  return [...path.slice(path.indexOf(current)), current]
}
