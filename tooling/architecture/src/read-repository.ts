import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import type { ArchitectureRepository, Workspace } from './types'

interface PackageManifest {
  name?: string
  workspaces?: string[]
  exports?: unknown
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const sourceGlob = new Bun.Glob('**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}')

export function readArchitectureRepository(root: string): ArchitectureRepository {
  const rootManifest = readManifest(resolve(root, 'package.json'))
  const manifestPaths = (rootManifest.workspaces ?? []).flatMap((workspacePattern) => [
    ...new Bun.Glob(`${workspacePattern}/package.json`).scanSync({ cwd: root, onlyFiles: true }),
  ])

  return {
    workspaces: manifestPaths.map((manifestPath) => readWorkspace(root, manifestPath)).sort(byWorkspaceName),
  }
}

function readWorkspace(root: string, manifestPath: string): Workspace {
  const manifest = readManifest(resolve(root, manifestPath))
  if (!manifest.name) throw new Error(`Workspace manifest has no name: ${manifestPath}`)

  const workspacePath = manifestPath.slice(0, -'/package.json'.length)
  const sourceFiles = [...sourceGlob.scanSync({ cwd: resolve(root, workspacePath), onlyFiles: true })]
    .filter((path) => !isIgnoredSource(path))
    .map((path) => {
      const repositoryPath = `${workspacePath}/${path}`
      const source = readFileSync(resolve(root, repositoryPath), 'utf8')
      return { repositoryPath, source }
    })

  return {
    name: manifest.name,
    path: workspacePath,
    dependencies: declaredDependencies(manifest),
    exports: exportedSubpaths(manifest.exports),
    sourceFiles: sourceFiles.map(({ repositoryPath, source }) => ({
      path: repositoryPath,
      imports: scanImports(source),
    })),
  }
}

function scanImports(source: string): string[] {
  return [...new Set(ts.preProcessFile(source, true, true).importedFiles.map(({ fileName }) => fileName))]
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function declaredDependencies(manifest: PackageManifest): string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ].sort()
}

function exportedSubpaths(exportsField: unknown): string[] {
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) return ['.']
  if (!exportsField || typeof exportsField !== 'object') return []

  const keys = Object.keys(exportsField)
  return keys.some((key) => key.startsWith('.')) ? keys.sort() : ['.']
}

function isIgnoredSource(path: string): boolean {
  return path.split('/').some((segment) => ['node_modules', 'dist', '.next', 'coverage'].includes(segment))
}

function byWorkspaceName(left: Workspace, right: Workspace): number {
  return left.name.localeCompare(right.name)
}
