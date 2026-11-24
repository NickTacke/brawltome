import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSetIndexPath, readIndexSets } from '../src/art-files'
import { fakeSetIndex, fakeSets } from './fake-export'

describe('a set index', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'replay-worker-index-'))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function indexFile(text: string): string {
    const path = join(root, `${Bun.hash(text)}.json`)

    writeFileSync(path, text)

    return path
  }

  test('names every set once, without the rows that need none', () => {
    const index = JSON.parse(fakeSetIndex('11.00').text)

    index.weaponSkins['5'] = fakeSets[0]

    expect(readIndexSets(indexFile(JSON.stringify(index)))).toEqual(fakeSets)
  })

  test('is refused when it is not an index, or names a set outside the store layout', () => {
    const index = JSON.parse(fakeSetIndex('11.00').text)

    expect(readIndexSets(indexFile('not json'))).toBeNull()
    expect(readIndexSets(indexFile(JSON.stringify({ ...index, classes: undefined })))).toBeNull()
    expect(readIndexSets(indexFile(JSON.stringify({ ...index, skins: { '1': '../../etc/passwd' } })))).toBeNull()
    expect(readIndexSets(indexFile(JSON.stringify({ ...index, classes: { Unarmed: 'Idle' } })))).toBeNull()
    expect(readIndexSets(indexFile(JSON.stringify({ ...index, classes: { Unarmed: { Idle: 7 } } })))).toBeNull()
  })

  test('is stored as sets/<32 hex digits>.json', () => {
    expect(isSetIndexPath(fakeSetIndex('11.00').path)).toBe(true)
    expect(isSetIndexPath(`sets/${'a'.repeat(31)}.json`)).toBe(false)
    expect(isSetIndexPath(`art/${'a'.repeat(32)}.json`)).toBe(false)
    expect(isSetIndexPath('sets/../x.json')).toBe(false)
  })
})
