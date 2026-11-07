import { describe, expect, test } from 'bun:test'
import { accountsModule } from '@brawltome/accounts'
import { type BrawltomeModule, checkModuleList } from '@brawltome/foundation'
import { refreshOperationsModule } from '@brawltome/refresh-operations'
import { replayAnalysisModule } from '@brawltome/replay-analysis'
import { apiModules } from '../src/modules'
import { workerModules } from '../src/worker-modules'

function without(modules: readonly BrawltomeModule[], left: BrawltomeModule): BrawltomeModule[] {
  return modules.filter((module) => module !== left)
}

describe('module lists', () => {
  test('the API loads every module its modules depend on', () => {
    expect(() => checkModuleList(apiModules)).not.toThrow()
  })

  test('the operations worker loads every module its modules depend on', () => {
    expect(() => checkModuleList(workerModules)).not.toThrow()
  })

  test('leaving out a module nothing depends on still passes', () => {
    expect(() => checkModuleList(without(apiModules, replayAnalysisModule))).not.toThrow()
  })

  test('leaving out a module others depend on names a dependant', () => {
    expect(() => checkModuleList(without(apiModules, refreshOperationsModule))).toThrow(
      'module player depends on refresh-operations, which is not loaded',
    )

    expect(() => checkModuleList(without(apiModules, accountsModule))).toThrow(
      'module replay-analysis depends on accounts, which is not loaded',
    )
  })
})
