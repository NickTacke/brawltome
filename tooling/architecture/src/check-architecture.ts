import { builtinModules } from 'node:module'
import { dirname, normalize, resolve } from 'node:path'
import type {
  ArchitecturePolicy,
  ArchitectureRepository,
  ArchitectureResult,
  ArchitectureViolation,
  TemporaryArchitectureException,
  Workspace,
  WorkspaceRole,
} from './types'

const nodeBuiltins = new Set(
  builtinModules.flatMap((name) => {
    const bareName = name.replace(/^node:/, '')
    return [bareName, `node:${bareName}`]
  }),
)

const allowedRoleDependencies: Record<WorkspaceRole, WorkspaceRole[]> = {
  application: ['adapter', 'capability', 'contracts', 'foundation'],
  capability: ['capability', 'foundation'],
  foundation: ['foundation'],
  contracts: ['foundation'],
  adapter: ['capability', 'contracts', 'foundation'],
  tooling: ['adapter', 'capability', 'contracts', 'foundation'],
  legacy: [],
}

export function checkArchitecture(repository: ArchitectureRepository, policy: ArchitecturePolicy): ArchitectureResult {
  const workspaceByName = new Map(repository.workspaces.map((workspace) => [workspace.name, workspace]))
  const violations = [
    ...repository.workspaces
      .filter((workspace) => !policy.roles[workspace.name])
      .map(
        (workspace): ArchitectureViolation => ({
          rule: 'missing-workspace-role',
          importer: workspace.name,
          message: `${workspace.name} does not have an assigned workspace role`,
        }),
      ),
    ...checkExports(repository.workspaces, policy),
    ...checkDeclaredDependencies(repository.workspaces, workspaceByName, policy),
    ...checkImports(repository.workspaces, workspaceByName, policy),
    ...checkCycles(repository.workspaces, workspaceByName),
  ]
  const matchedFiles = new Map<TemporaryArchitectureException, Set<string>>()
  const unexcepted = violations.filter((violation) => {
    const exception = policy.exceptions.find((candidate) => matchesException(candidate, violation))
    if (!exception || !violation.file) return true
    const files = matchedFiles.get(exception) ?? new Set<string>()
    files.add(violation.file)
    matchedFiles.set(exception, files)
    return false
  })
  const appliedExceptions = [...matchedFiles.keys()]

  return {
    violations: unexcepted,
    appliedExceptions,
    staleExceptions: policy.exceptions.filter((exception) => {
      const files = matchedFiles.get(exception)
      return (
        !Array.isArray(exception.files) ||
        exception.files.length === 0 ||
        !files ||
        exception.files.some((file) => !files.has(file))
      )
    }),
  }
}

function checkExports(workspaces: Workspace[], policy: ArchitecturePolicy): ArchitectureViolation[] {
  return workspaces.flatMap((workspace) =>
    workspace.exports
      .filter((exportPath) => !policy.allowedExports[workspace.name]?.includes(exportPath))
      .map((exportPath) => ({
        rule: 'package-export' as const,
        importer: workspace.name,
        file: `${workspace.path}/package.json`,
        importPath: exportPath,
        message: `${workspace.name} exposes unapproved package export ${exportPath}`,
      })),
  )
}

function checkDeclaredDependencies(
  workspaces: Workspace[],
  workspaceByName: Map<string, Workspace>,
  policy: ArchitecturePolicy,
): ArchitectureViolation[] {
  return workspaces.flatMap((importer) =>
    importer.dependencies.flatMap((dependencyName) => {
      const dependency = workspaceByName.get(dependencyName)
      if (!dependency) return []
      const violation = checkDependencyRule(importer, dependency, policy, {
        importer: importer.name,
        dependency: dependency.name,
        file: `${importer.path}/package.json`,
        importPath: dependency.name,
      })
      return violation ? [violation] : []
    }),
  )
}

function checkImports(
  workspaces: Workspace[],
  workspaceByName: Map<string, Workspace>,
  policy: ArchitecturePolicy,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = []

  for (const importer of workspaces) {
    if (!policy.roles[importer.name]) continue

    for (const sourceFile of importer.sourceFiles) {
      for (const importPath of sourceFile.imports) {
        if (importPath.startsWith('.')) {
          const target = findRelativeTarget(importer, sourceFile.path, importPath, workspaces)
          if (target && target.name !== importer.name) {
            violations.push({
              rule: 'cross-package-relative-import',
              importer: importer.name,
              dependency: target.name,
              file: sourceFile.path,
              importPath,
              message: `${importer.name} crosses into ${target.name} through a relative import`,
            })
          }
          continue
        }

        if (isAlias(importPath)) {
          const allowedAliases = policy.localImportAliases[importer.name] ?? []
          if (!isConfinedLocalAlias(importPath, importer, allowedAliases)) {
            violations.push({
              rule: 'unresolved-alias',
              importer: importer.name,
              file: sourceFile.path,
              importPath,
              message: `${importer.name} uses unresolved or escaping import alias ${importPath}`,
            })
          }
          continue
        }

        const dependencyName = workspaceNameFromSpecifier(importPath, workspaceByName)
        if (!dependencyName) {
          const externalDependency = externalDependencyName(importPath)
          if (externalDependency && !importer.dependencies.includes(externalDependency)) {
            violations.push({
              rule: 'undeclared-dependency',
              importer: importer.name,
              dependency: externalDependency,
              file: sourceFile.path,
              importPath,
              message: `${importer.name} imports undeclared dependency ${externalDependency}`,
            })
          }
          continue
        }
        const dependency = workspaceByName.get(dependencyName)
        if (!dependency) continue

        const common = {
          importer: importer.name,
          dependency: dependency.name,
          file: sourceFile.path,
          importPath,
        }

        if (dependency.name === importer.name) {
          if (!isExported(importPath, dependency)) {
            violations.push({
              rule: 'deep-import',
              ...common,
              message: `${importPath} is not exported by ${dependency.name}`,
            })
          }
          continue
        }

        if (!importer.dependencies.includes(dependency.name)) {
          violations.push({
            rule: 'undeclared-dependency',
            ...common,
            message: `${importer.name} imports undeclared workspace dependency ${dependency.name}`,
          })
        }

        if (!isExported(importPath, dependency)) {
          violations.push({
            rule: 'deep-import',
            ...common,
            message: `${importPath} is not exported by ${dependency.name}`,
          })
        }

        const compositionEntry = `${dependency.name}/composition`
        const isCompositionEntry = importPath === compositionEntry
        const isNestedCompositionImport = importPath.startsWith(`${compositionEntry}/`)
        if (isNestedCompositionImport || (isCompositionEntry && !policy.compositionImporters.includes(importer.name))) {
          violations.push({
            rule: 'composition-import',
            ...common,
            message: `${importer.name} is not authorized to import composition entrypoints`,
          })
        }

        const dependencyViolation = checkDependencyRule(importer, dependency, policy, common)
        if (dependencyViolation) violations.push(dependencyViolation)
      }
    }
  }

  return violations
}

function checkDependencyRule(
  importer: Workspace,
  dependency: Workspace,
  policy: ArchitecturePolicy,
  location: Pick<ArchitectureViolation, 'importer' | 'dependency' | 'file' | 'importPath'>,
): ArchitectureViolation | undefined {
  const importerRole = policy.roles[importer.name]
  const dependencyRole = policy.roles[dependency.name]
  if (!importerRole || !dependencyRole || importer.name === dependency.name) return undefined

  if (importerRole === 'application' && dependencyRole === 'application') {
    return {
      rule: 'app-to-app',
      ...location,
      message: `${importer.name} imports application source from ${dependency.name}`,
    }
  }

  const allowedRoles = policy.workspaceRoleDependencies[importer.name] ?? allowedRoleDependencies[importerRole]
  const roleIsForbidden = !allowedRoles.includes(dependencyRole)
  const contractDependencyIsForbidden =
    importerRole === 'contracts' && !policy.contractsDependencies.includes(dependency.name)
  if (roleIsForbidden || contractDependencyIsForbidden) {
    return {
      rule: 'role-dependency',
      ...location,
      message: `${importerRole} ${importer.name} cannot depend on ${dependencyRole} ${dependency.name}`,
    }
  }

  if (
    importerRole === 'capability' &&
    dependencyRole === 'capability' &&
    !policy.capabilityDependencies[importer.name]?.includes(dependency.name)
  ) {
    return {
      rule: 'capability-allow-list',
      ...location,
      message: `${importer.name} is not allowed to depend on capability ${dependency.name}`,
    }
  }

  return undefined
}

function checkCycles(workspaces: Workspace[], workspaceByName: Map<string, Workspace>): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = []
  const visited = new Set<string>()
  const active = new Set<string>()
  const stack: string[] = []
  const reported = new Set<string>()

  function visit(workspace: Workspace) {
    if (active.has(workspace.name)) {
      const cycleStart = stack.indexOf(workspace.name)
      const cycle = [...stack.slice(cycleStart), workspace.name]
      const key = [...new Set(cycle)].sort().join('|')
      if (!reported.has(key)) {
        reported.add(key)
        violations.push({
          rule: 'cycle',
          importer: workspace.name,
          dependency: stack.at(-1),
          message: `Workspace dependency cycle: ${cycle.join(' -> ')}`,
        })
      }
      return
    }
    if (visited.has(workspace.name)) return

    active.add(workspace.name)
    stack.push(workspace.name)
    for (const dependencyName of workspace.dependencies) {
      const dependency = workspaceByName.get(dependencyName)
      if (dependency) visit(dependency)
    }
    stack.pop()
    active.delete(workspace.name)
    visited.add(workspace.name)
  }

  for (const workspace of workspaces) visit(workspace)
  return violations
}

function isAlias(specifier: string): boolean {
  return specifier.startsWith('@/') || specifier.startsWith('#') || specifier.startsWith('/')
}

function isConfinedLocalAlias(specifier: string, importer: Workspace, prefixes: string[]): boolean {
  const prefix = prefixes.find((candidate) => specifier.startsWith(candidate))
  if (!prefix) return false

  const workspaceRoot = normalize(resolve('/', importer.path))
  const target = normalize(resolve(workspaceRoot, specifier.slice(prefix.length)))
  return target === workspaceRoot || target.startsWith(`${workspaceRoot}/`)
}

function externalDependencyName(specifier: string): string | undefined {
  if (specifier.startsWith('bun:') || nodeBuiltins.has(specifier) || nodeBuiltins.has(specifier.split('/')[0])) {
    return undefined
  }

  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return name ? `${scope}/${name}` : undefined
  }
  return specifier.split('/')[0] || undefined
}

function workspaceNameFromSpecifier(specifier: string, workspaceByName: Map<string, Workspace>): string | undefined {
  return [...workspaceByName.keys()]
    .sort((left, right) => right.length - left.length)
    .find((name) => specifier === name || specifier.startsWith(`${name}/`))
}

function isExported(specifier: string, dependency: Workspace): boolean {
  if (specifier === dependency.name) return dependency.exports.includes('.')
  const subpath = `.${specifier.slice(dependency.name.length)}`
  return dependency.exports.some((exportPath) => {
    if (exportPath === subpath) return true
    if (!exportPath.includes('*')) return false
    const [prefix, suffix] = exportPath.split('*')
    return subpath.startsWith(prefix) && subpath.endsWith(suffix)
  })
}

function findRelativeTarget(
  importer: Workspace,
  sourcePath: string,
  specifier: string,
  workspaces: Workspace[],
): Workspace | undefined {
  const absoluteTarget = normalize(resolve('/', dirname(sourcePath), specifier))
  return workspaces.find((candidate) => {
    if (candidate.name === importer.name) return false
    const workspaceRoot = normalize(resolve('/', candidate.path))
    return absoluteTarget === workspaceRoot || absoluteTarget.startsWith(`${workspaceRoot}/`)
  })
}

function matchesException(exception: TemporaryArchitectureException, violation: ArchitectureViolation): boolean {
  return (
    exception.rule === violation.rule &&
    exception.importer === violation.importer &&
    optionalMatch(exception.dependency, violation.dependency) &&
    Array.isArray(exception.files) &&
    exception.files.length > 0 &&
    violation.file !== undefined &&
    exception.files.includes(violation.file) &&
    optionalMatch(exception.importPath, violation.importPath)
  )
}

function optionalMatch(expected: string | undefined, actual: string | undefined): boolean {
  return expected === undefined || expected === actual
}
