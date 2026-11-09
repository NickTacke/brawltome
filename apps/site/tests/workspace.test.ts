import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const siteRoot = join(import.meta.dir, '..')
const repoRoot = join(siteRoot, '..', '..')
const databaseClients = ['postgres', 'drizzle-orm']

function readPackage(root: string) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
}

function sourceFiles(): string[] {
  const entries = readdirSync(join(siteRoot, 'src'), { recursive: true, encoding: 'utf8' })

  return entries.filter((entry) => /\.tsx?$/.test(entry)).map((entry) => join(siteRoot, 'src', entry))
}

describe('site workspace', () => {
  test('the site declares no database client', () => {
    const { dependencies = {}, devDependencies = {} } = readPackage(siteRoot)
    const declared = Object.keys({ ...dependencies, ...devDependencies })

    expect(declared.filter((name) => databaseClients.includes(name))).toEqual([])
  })

  test('no site source imports a database client', () => {
    const importsDatabase = (file: string) =>
      databaseClients.some((name) => readFileSync(file, 'utf8').includes(`from '${name}`))

    expect(sourceFiles().filter(importsDatabase)).toEqual([])
  })

  // tanstack's plugin is hoisted to the root and checks the dev server against the root vite, a mismatch 404s every page
  test('the root and the site pin the same vite', () => {
    expect(readPackage(repoRoot).devDependencies.vite).toBe(readPackage(siteRoot).devDependencies.vite)
  })
})
