#!/usr/bin/env bun

import { resolve } from 'node:path'
import { checkArchitecture } from './check-architecture'
import { currentArchitecturePolicy } from './current-policy'
import { readArchitectureRepository } from './read-repository'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const result = checkArchitecture(readArchitectureRepository(repositoryRoot), currentArchitecturePolicy)

for (const violation of result.violations.sort(byDiagnostic)) {
  const location = violation.file ? ` ${violation.file}` : ''
  console.error(`[${violation.rule}]${location}: ${violation.message}`)
}

for (const exception of result.staleExceptions.sort((left, right) => left.id.localeCompare(right.id))) {
  console.error(`[stale-exception] ${exception.id}: ${exception.expiresWhen}`)
}

if (result.violations.length > 0 || result.staleExceptions.length > 0) {
  process.exit(1)
}

const exceptionSummary = result.appliedExceptions
  .map(({ id }) => id)
  .sort()
  .join(', ')
console.log(`Architecture check passed with ${result.appliedExceptions.length} temporary V2 exceptions.`)
console.log(exceptionSummary)

function byDiagnostic(left: (typeof result.violations)[number], right: (typeof result.violations)[number]): number {
  return `${left.rule}:${left.file ?? ''}:${left.importer}`.localeCompare(
    `${right.rule}:${right.file ?? ''}:${right.importer}`,
  )
}
