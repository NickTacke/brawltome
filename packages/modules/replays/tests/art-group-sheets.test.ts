import { describe, expect, test } from 'bun:test'
import { readArtGroupSheets } from '../art-group-sheets'

const base = 'sheets/5555555555555555.webp'
const weights = 'sheets/6666666666666666.webp'
const plain = 'sheets/7777777777777777.webp'

// a pre-drawn set in format 4: a weighted sheet with its weight sheet, and a plain one
function setFile(sheets: unknown) {
  return { format: 4, sheets, pieces: [], bones: {}, weapons: {}, set: { kind: 'skin', drawing: 1 } }
}

describe('readArtGroupSheets', () => {
  test('lists every sheet of a format 4 group and its weight sheets, once each', () => {
    const sheets = [
      { src: base, w: 4, h: 4, bytes: 10, weights: [{ src: weights, bytes: 8 }] },
      { src: plain, w: 4, h: 4, bytes: 10 },
      { src: plain, w: 4, h: 4, bytes: 10 },
    ]

    expect(readArtGroupSheets(setFile(sheets))).toEqual({ paths: [base, weights, plain] })
  })

  test('names no sheets for a format 3 group, which is stored unchecked as before', () => {
    expect(readArtGroupSheets({ format: 3, sheets: [{ src: base, w: 4, h: 4, bytes: 10 }] })).toEqual({ paths: [] })
    expect(readArtGroupSheets({ format: 3, sheets: 'not a list' })).toEqual({ paths: [] })
  })

  test('refuses a format 4 group whose sheets or weight sheets are not sheets in the art layout', () => {
    expect(readArtGroupSheets(setFile('not a list'))).toHaveProperty('reason')
    expect(readArtGroupSheets(setFile([{ src: '../x.webp' }]))).toHaveProperty('reason')
    expect(readArtGroupSheets(setFile([{ src: `art/${'1'.repeat(32)}.json` }]))).toHaveProperty('reason')
    expect(readArtGroupSheets(setFile([{ src: base, weights: 'none' }]))).toHaveProperty('reason')
    expect(readArtGroupSheets(setFile([{ src: base, weights: [{ src: 7 }] }]))).toHaveProperty('reason')
    expect(readArtGroupSheets(setFile([{ src: base, weights: [null] }]))).toHaveProperty('reason')
  })
})
