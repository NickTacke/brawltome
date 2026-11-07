import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { generateContractOpenApi, serializeContractOpenApi } from '../src'

describe('OpenAPI contract artifact', () => {
  test('regenerates the committed OpenAPI document without a diff', async () => {
    const committed = await Bun.file(resolve(import.meta.dir, '../openapi/contracts.openapi.json')).text()

    expect(serializeContractOpenApi(generateContractOpenApi())).toBe(committed)
  })
})
