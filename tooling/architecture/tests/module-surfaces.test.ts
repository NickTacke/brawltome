import { describe, expect, test } from 'bun:test'
import * as accounts from '@brawltome/accounts'
import * as analytics from '@brawltome/analytics'
import * as clan from '@brawltome/clan'
import * as discovery from '@brawltome/discovery'
import type { BrawltomeModule } from '@brawltome/foundation'
import * as player from '@brawltome/player'
import * as queue from '@brawltome/queue'
import * as ranking from '@brawltome/ranking'
import * as replayAnalysis from '@brawltome/replay-analysis'
import * as requestAdmission from '@brawltome/request-admission'
import * as statistics from '@brawltome/statistics'
import { Column, is, Table, View } from 'drizzle-orm'
import { integer, PgSchema, pgSchema, pgTable, pgView } from 'drizzle-orm/pg-core'
import { currentArchitecturePolicy } from '../src/current-policy'
import * as namespaceFixture from './drizzle-namespace-fixture'

type ModulePackage = {
  exports: Record<string, unknown>
  module: BrawltomeModule
}

const modulePackages: Record<string, ModulePackage> = {
  '@brawltome/accounts': { exports: accounts, module: accounts.accountsModule },
  '@brawltome/analytics': { exports: analytics, module: analytics.analyticsModule },
  '@brawltome/clan': { exports: clan, module: clan.clanModule },
  '@brawltome/discovery': { exports: discovery, module: discovery.discoveryModule },
  '@brawltome/player': { exports: player, module: player.playerModule },
  '@brawltome/ranking': { exports: ranking, module: ranking.rankingModule },
  '@brawltome/queue': { exports: queue, module: queue.queueModule },
  '@brawltome/replay-analysis': { exports: replayAnalysis, module: replayAnalysis.replayAnalysisModule },
  '@brawltome/request-admission': { exports: requestAdmission, module: requestAdmission.requestAdmissionModule },
  '@brawltome/statistics': { exports: statistics, module: statistics.statisticsModule },
}

function isQueryableDrizzleObject(value: unknown): boolean {
  return is(value, Table) || is(value, View) || is(value, PgSchema) || is(value, Column)
}

function isPlainContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return true

  if (typeof value !== 'object' || value === null) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

// `import * as` and `export * as` give a module namespace object, whose prototype is neither of the above
function isModuleNamespace(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Module]'
}

// export paths of drizzle objects, looking inside plain objects, arrays and namespaces too (e.g. `schema.profiles`);
// seen stops the walk at a namespace or object it has already visited, so import cycles end
function findDrizzleExports(value: unknown, path: string, seen = new Set<unknown>()): string[] {
  if (isQueryableDrizzleObject(value)) return [path]

  if (!(isPlainContainer(value) || isModuleNamespace(value)) || seen.has(value)) return []

  seen.add(value)

  return Object.entries(value).flatMap(([key, child]) => findDrizzleExports(child, `${path}.${key}`, seen))
}

describe('module package surfaces', () => {
  test('cover every module package the policy knows', () => {
    const policyModulePackages = Object.values(currentArchitecturePolicy.moduleSchemas).sort()

    expect(Object.keys(modulePackages).sort()).toEqual(policyModulePackages)
  })

  test('the check recognises drizzle tables, views, schemas and columns', () => {
    const schema = pgSchema('example')
    const table = pgTable('example', { id: integer('id') })
    const view = pgView('example_view', { id: integer('id') }).existing()

    const found = findDrizzleExports({ schema, nested: { table }, list: [view], column: table.id }, 'example')

    expect(found).toEqual(['example.schema', 'example.nested.table', 'example.list.0', 'example.column'])
  })

  test('the check looks inside a namespace re-export such as export * as schema', () => {
    expect(findDrizzleExports(namespaceFixture, 'fixture')).toEqual(['fixture.schema.profiles'])
  })

  // drizzle queries name no `schema.table` text, so the cross-module sql rule can't see them; a module that
  // exported its tables would let other modules query them unflagged
  test.each(Object.keys(modulePackages))('%s exports no drizzle table, view, schema or column', (packageName) => {
    const { exports } = modulePackages[packageName] as ModulePackage

    expect(findDrizzleExports(exports, packageName)).toEqual([])
  })

  // an import is only safe when the imported module is loaded wherever the importer is
  test.each(Object.keys(modulePackages))('%s lists every capability it imports in dependsOn', (packageName) => {
    const { module } = modulePackages[packageName] as ModulePackage
    const importedPackages = currentArchitecturePolicy.capabilityDependencies[packageName] ?? []

    const missingPackages = importedPackages.filter((importedPackage) => {
      const importedModuleName = modulePackages[importedPackage]?.module.name

      return importedModuleName === undefined || !module.dependsOn.includes(importedModuleName)
    })

    expect(missingPackages).toEqual([])
  })
})
