export type WorkspaceRole = 'application' | 'capability' | 'foundation' | 'contracts' | 'adapter' | 'tooling' | 'legacy'

export type ArchitectureRule =
  | 'app-to-app'
  | 'capability-allow-list'
  | 'composition-import'
  | 'cross-package-relative-import'
  | 'cycle'
  | 'deep-import'
  | 'missing-workspace-role'
  | 'package-export'
  | 'role-dependency'
  | 'undeclared-dependency'
  | 'unresolved-alias'

export interface SourceFile {
  path: string
  imports: string[]
}

export interface Workspace {
  name: string
  path: string
  dependencies: string[]
  exports: string[]
  sourceFiles: SourceFile[]
}

export interface ArchitectureRepository {
  workspaces: Workspace[]
}

export interface TemporaryArchitectureException {
  id: string
  rule: ArchitectureRule
  importer: string
  dependency?: string
  files: [string, ...string[]]
  importPath?: string
  reason: string
  issue: string
  expiresWhen: string
}

export interface ArchitecturePolicy {
  roles: Record<string, WorkspaceRole>
  allowedExports: Record<string, string[]>
  capabilityDependencies: Record<string, string[]>
  compositionImporters: string[]
  contractsDependencies: string[]
  localImportAliases: Record<string, string[]>
  workspaceRoleDependencies: Record<string, WorkspaceRole[]>
  exceptions: TemporaryArchitectureException[]
}

export interface ArchitectureViolation {
  rule: ArchitectureRule
  importer: string
  dependency?: string
  file?: string
  importPath?: string
  message: string
}

export interface ArchitectureResult {
  violations: ArchitectureViolation[]
  appliedExceptions: TemporaryArchitectureException[]
  staleExceptions: TemporaryArchitectureException[]
}
