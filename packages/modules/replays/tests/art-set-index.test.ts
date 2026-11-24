import { describe, expect, test } from 'bun:test'
import { readSetIndex } from '../art-set-index'
import { fakeSetIndex } from './fixtures/art'

const skinSet = `art/${'a'.repeat(32)}.json`
const classSet = `art/${'b'.repeat(32)}.json`

describe('readSetIndex', () => {
  test("lists the patch, the sets' format and every set the index names, once each, without the index's words", () => {
    const index = fakeSetIndex('11.00', [skinSet, classSet])

    expect(readSetIndex({ ...index, weaponSkins: { '3': skinSet, '4': 'draw per look' } })).toEqual({
      patch: '11.00',
      format: 4,
      sets: [skinSet, classSet],
    })

    expect(readSetIndex(fakeSetIndex('11.00', [skinSet], 5))).toMatchObject({ format: 5 })
  })

  test('an index whose rows all need no set names none', () => {
    const index = { patch: '11.00', format: 4, skins: { '1': 'nothing to draw' }, weaponSkins: {}, classes: {} }

    expect(readSetIndex(index)).toEqual({ patch: '11.00', format: 4, sets: [] })
  })

  test('refuses an index without its patch, set format or sections', () => {
    const index = fakeSetIndex('11.00', [skinSet, classSet])

    expect(readSetIndex([])).toHaveProperty('reason')
    expect(readSetIndex({ ...index, patch: 11 })).toHaveProperty('reason')
    expect(readSetIndex({ ...index, format: undefined })).toHaveProperty('reason')
    expect(readSetIndex({ ...index, format: '4' })).toHaveProperty('reason')
    expect(readSetIndex({ ...index, format: 4.5 })).toHaveProperty('reason')
    expect(readSetIndex({ ...index, format: 40_000 })).toHaveProperty('reason')
    expect(readSetIndex({ ...index, skins: undefined })).toHaveProperty('reason')
    expect(readSetIndex({ ...index, classes: { Unarmed: 'Idle' } })).toHaveProperty('reason')
    expect(readSetIndex({ ...index, classes: { Unarmed: { Idle: classSet } } })).toHaveProperty('reason')
  })

  test('refuses an index naming anything but a set path or one of its words', () => {
    const index = fakeSetIndex('11.00', [skinSet, classSet])

    expect(readSetIndex({ ...index, skins: { '1': '../outside.json' } })).toHaveProperty('reason')
    expect(readSetIndex({ ...index, skins: { '1': `maps/${'4'.repeat(32)}.json` } })).toHaveProperty('reason')
    expect(readSetIndex({ ...index, weaponSkins: { '1': 7 } })).toHaveProperty('reason')

    expect(
      readSetIndex({ ...index, classes: { Unarmed: { Idle: { set: 'sets/x.json', bones: [] } } } }),
    ).toHaveProperty('reason')
  })
})
