import { describe, expect, test } from 'bun:test'
import { createR2Client } from '../src/r2'

describe('createR2Client', () => {
  test('returns null when any credential is missing', () => {
    expect(createR2Client({ accessKeyId: '', secretAccessKey: 'x', endpoint: 'x', bucket: 'x' })).toBeNull()
    expect(createR2Client({ accessKeyId: 'x', secretAccessKey: '', endpoint: 'x', bucket: 'x' })).toBeNull()
    expect(createR2Client({ accessKeyId: 'x', secretAccessKey: 'x', endpoint: '', bucket: 'x' })).toBeNull()
    expect(createR2Client({ accessKeyId: 'x', secretAccessKey: 'x', endpoint: 'x', bucket: '' })).toBeNull()
  })

  test('returns client with put, get, delete, presignGet when configured', () => {
    const c = createR2Client({
      accessKeyId: 'a',
      secretAccessKey: 'b',
      endpoint: 'https://example.com',
      bucket: 'x',
    })
    if (!c) throw new Error('createR2Client returned null with valid config')
    expect(typeof c.put).toBe('function')
    expect(typeof c.get).toBe('function')
    expect(typeof c.delete).toBe('function')
    expect(typeof c.presignGet).toBe('function')
  })
})
