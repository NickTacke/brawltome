import type { Migration } from './migration'

/** What a process needs to know about a domain module to load it and migrate its schema. */
export type BrawltomeModule = {
  name: string
  dependsOn: readonly string[]
  migrations: readonly Migration[]
}

export function checkModuleList(modules: readonly BrawltomeModule[]): void {
  const loadedNames = new Set<string>()

  for (const module of modules) {
    if (loadedNames.has(module.name)) {
      throw new Error(`module ${module.name} is listed twice`)
    }

    loadedNames.add(module.name)
  }

  for (const module of modules) {
    const missingName = module.dependsOn.find((name) => !loadedNames.has(name))

    if (missingName) {
      throw new Error(`module ${module.name} depends on ${missingName}, which is not loaded`)
    }
  }

  checkNoCycle(modules)
  checkMigrationOwners(modules)
}

// the migration plan chains predecessors per owner prefix, so a module's migrations need one prefix of their own
function checkMigrationOwners(modules: readonly BrawltomeModule[]): void {
  const moduleNameByOwner = new Map<string, string>()

  for (const module of modules) {
    const owner = singleMigrationOwner(module)

    if (owner === undefined) continue

    const otherModuleName = moduleNameByOwner.get(owner)

    if (otherModuleName !== undefined) {
      throw new Error(`modules ${otherModuleName} and ${module.name} both own migrations under ${owner}`)
    }

    moduleNameByOwner.set(owner, module.name)
  }
}

// undefined for a module without migrations
function singleMigrationOwner(module: BrawltomeModule): string | undefined {
  const owners = [...new Set(module.migrations.map(({ identity }) => identity.split('/')[0]))]

  if (owners.length > 1) {
    throw new Error(`module ${module.name} has migrations under more than one owner: ${owners.join(', ')}`)
  }

  return owners[0]
}

function checkNoCycle(modules: readonly BrawltomeModule[]): void {
  const dependenciesByName = new Map(modules.map((module) => [module.name, module.dependsOn]))
  const acyclicNames = new Set<string>()

  for (const module of modules) {
    const cycle = findCycle(module.name, [], dependenciesByName, acyclicNames)

    if (cycle) {
      throw new Error(`modules depend on each other in a cycle: ${cycle.join(' -> ')}`)
    }
  }
}

// depth-first walk along dependsOn; reaching a name that is already on the path closes a cycle
function findCycle(
  name: string,
  path: readonly string[],
  dependenciesByName: ReadonlyMap<string, readonly string[]>,
  acyclicNames: Set<string>,
): string[] | null {
  if (path.includes(name)) {
    return [...path.slice(path.indexOf(name)), name]
  }

  if (acyclicNames.has(name)) {
    return null
  }

  const pathWithName = [...path, name]

  for (const dependency of dependenciesByName.get(name) ?? []) {
    const cycle = findCycle(dependency, pathWithName, dependenciesByName, acyclicNames)

    if (cycle) {
      return cycle
    }
  }

  acyclicNames.add(name)

  return null
}
