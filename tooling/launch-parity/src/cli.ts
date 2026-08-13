import { resolve } from 'node:path'
import { launchParityMatrix } from './matrix'
import { evidenceCommand, validateRepositoryParity } from './validate'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const errors = validateRepositoryParity(launchParityMatrix, repositoryRoot)

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

const executedEvidence = new Set<string>()
for (const row of launchParityMatrix) {
  if (row.status !== 'verified') continue
  for (const evidence of row.evidence) {
    const command = evidenceCommand(evidence)
    if (!command) continue
    const key = command.join('\0')
    if (executedEvidence.has(key)) continue
    executedEvidence.add(key)
    const result = Bun.spawnSync(command, { cwd: repositoryRoot, stdout: 'inherit', stderr: 'inherit' })
    if (result.exitCode !== 0) process.exit(result.exitCode)
  }
}

const statusCounts = Object.groupBy(launchParityMatrix, (row) => row.status)
const summary = Object.entries(statusCounts)
  .map(([status, rows]) => `${status}: ${rows?.length ?? 0}`)
  .join(', ')
console.log(`Launch parity matrix is structurally valid (${summary}).`)
