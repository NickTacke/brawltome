import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')
const thisFile = 'tooling/architecture/tests/runtime-topology.test.ts'
const forbiddenTechnology = ['re', 'dis'].join('')
const forbiddenDependency = ['io', forbiddenTechnology].join('')
const forbiddenEnvironment = [forbiddenTechnology.toUpperCase(), 'URL'].join('_')
const forbiddenPort = ['63', '79'].join('')

describe('PostgreSQL-only runtime topology', () => {
  test('contains no superseded state-store runtime path or dependency', () => {
    const result = Bun.spawnSync({
      cmd: [
        'git',
        'grep',
        '-I',
        '-i',
        '-l',
        ...[forbiddenTechnology, forbiddenDependency, forbiddenEnvironment, forbiddenPort].flatMap((token) => [
          '-e',
          token,
        ]),
        '--',
        '.',
        `:(exclude)${thisFile}`,
        ':(exclude)infra/app/tests/**',
        ':(exclude)LICENSE',
      ],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(result.exitCode, result.stderr.toString()).toBe(1)
    expect(result.stdout.toString()).toBe('')
  })

  test('renders only local PostgreSQL', () => {
    const result = Bun.spawnSync({
      cmd: ['docker', 'compose', '--profile', '*', '-f', 'docker-compose.yml', 'config', '--format', 'json'],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const topology = JSON.parse(result.stdout.toString()) as { services: Record<string, unknown> }
    expect(Object.keys(topology.services)).toEqual(['postgres'])
    expect(JSON.stringify(topology)).not.toContain(forbiddenPort)
    expect(JSON.stringify(topology)).not.toContain(forbiddenEnvironment)
  }, 15_000)
})
