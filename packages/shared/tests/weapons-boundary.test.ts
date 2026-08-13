import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('the client-safe weapons entry excludes generated game datasets', async () => {
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, '../src/weapons.ts')],
    minify: true,
    target: 'browser',
    write: false,
  })

  expect(result.success).toBe(true)
  expect(result.outputs[0].size).toBeLessThan(20_000)
})
