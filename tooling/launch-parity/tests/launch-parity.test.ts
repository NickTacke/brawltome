import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchParityMatrix } from '../src/matrix'
import type { ParityRow } from '../src/schema'
import { evidenceCommand, validateLaunchParity, validateRepositoryParity } from '../src/validate'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const implementedRow: ParityRow = {
  id: 'shell.desktop-rail',
  area: 'shell-navigation',
  requirement: 'Desktop exposes the narrow navigation rail.',
  sourceIssue: '#188',
  status: 'implemented',
  destinations: [],
  implementation: ['apps/web/src/components/sidebar/AppSidebar.tsx'],
  evidence: [],
  verificationGap: 'Needs a browser viewport assertion.',
}

describe('launch parity validation', () => {
  test('rejects duplicate IDs, missing files, and dishonest verified claims', () => {
    const errors = validateLaunchParity(
      [
        implementedRow,
        { ...implementedRow, implementation: ['../outside.ts'] },
        { ...implementedRow, id: 'route.fake', status: 'verified', verificationGap: undefined },
        {
          ...implementedRow,
          id: 'route.source-evidence',
          status: 'verified',
          verificationGap: undefined,
          evidence: [
            {
              kind: 'unit',
              path: 'apps/web/src/components/sidebar/AppSidebar.tsx',
              assertion: 'Source exists.',
            },
          ],
        },
      ],
      repositoryRoot,
    )

    expect(errors).toContain('duplicate parity row id: shell.desktop-rail')
    expect(errors).toContain('shell.desktop-rail implementation path must stay inside the repository: ../outside.ts')
    expect(errors).toContain('route.fake verified rows require executable evidence')
    expect(errors).toContain(
      'route.source-evidence executable evidence must reference a test: apps/web/src/components/sidebar/AppSidebar.tsx',
    )
  })

  test('uses repository-owned commands for executable evidence', () => {
    expect(
      evidenceCommand({
        kind: 'unit',
        path: 'apps/web/tests/components/sidebar/navigation.test.ts',
        assertion: 'Navigation contract passes.',
      }),
    ).toEqual(['bun', 'test', 'apps/web/tests/components/sidebar/navigation.test.ts'])
    expect(
      evidenceCommand({ kind: 'manual', path: 'package.json', assertion: 'A human reviewed the shell.' }),
    ).toBeNull()
  })

  test('rejects paths that escape through symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'brawltome-parity-'))
    try {
      symlinkSync('/etc/hosts', join(root, 'escape'))
      expect(validateLaunchParity([{ ...implementedRow, implementation: ['escape'] }], root)).toContain(
        'shell.desktop-rail implementation path escapes the repository through a symlink: escape',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('requires blockers for planned rows and unexpired ownership for waivers', () => {
    const planned = { ...implementedRow, id: 'planned', status: 'planned', implementation: [] } as ParityRow
    const waived = {
      ...implementedRow,
      id: 'waived',
      status: 'waived',
      waiver: { owner: '', reason: '', expires: '2020-01-01' },
    } as ParityRow

    expect(validateLaunchParity([planned, waived], repositoryRoot, new Date('2026-01-01'))).toEqual([
      'planned planned rows require a blocker',
      'waived waived rows require an owner and reason',
      'waived waiver expired on 2020-01-01',
    ])
  })

  test('does not promote pending Windows evidence to verified acceptance', () => {
    const row = launchParityMatrix.find((candidate) => candidate.id === 'desktop.api-failure')
    if (!row) throw new Error('desktop API failure parity row is missing')

    expect(
      validateLaunchParity([{ ...row, status: 'verified', verificationGap: undefined }], repositoryRoot),
    ).toContain(
      'desktop.api-failure requires independently reviewed external Windows acceptance; repository evidence cannot self-promote it',
    )
  })

  test('keeps the repository matrix and web navigation contract consistent', () => {
    expect(validateRepositoryParity(launchParityMatrix, repositoryRoot)).toEqual([])

    const mutated = launchParityMatrix.map((row) =>
      row.id === 'route.player-id' ? { ...row, destinations: ['/wrong-route'], implementation: ['package.json'] } : row,
    )
    expect(validateRepositoryParity(mutated, repositoryRoot)).toContain(
      'route.player-id parity row does not match its preserved route fixture',
    )
  })
})
