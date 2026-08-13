import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  contractProofSchema,
  generateContractOpenApi,
  parseContractProofOutput,
  serializeContractOpenApi,
} from '../src'

const fixtureDirectory = resolve(import.meta.dir, 'fixtures')

async function fixture(name: string): Promise<unknown> {
  return Bun.file(resolve(fixtureDirectory, `${name}.json`)).json()
}

describe('canonical contract proof', () => {
  test.each(['valid-present', 'valid-missing-optional', 'valid-null'])('accepts %s', async (name) => {
    const input = await fixture(name)
    expect(JSON.stringify(contractProofSchema.parse(input))).toBe(JSON.stringify(input))
  })

  test.each([
    'invalid-missing-nullable',
    'invalid-negative',
    'invalid-out-of-range',
    'invalid-offset-date-time',
    'invalid-date-time',
    'invalid-union',
  ])('rejects %s at the producer boundary', async (name) => {
    const input = await fixture(name)
    expect(() => parseContractProofOutput(input)).toThrow()
  })

  test('preserves zero and rejects both integer overflow directions', async () => {
    const valid = contractProofSchema.parse(await fixture('valid-present'))
    expect(valid.count).toBe(0)
    expect(valid.event).toEqual({ kind: 'ready', attempt: 0 })
    expect(() => contractProofSchema.parse({ ...valid, count: -1 })).toThrow()
    expect(() => contractProofSchema.parse({ ...valid, count: 2_147_483_648 })).toThrow()
  })
})

describe('OpenAPI contract artifact', () => {
  test('encodes required-nullable, optional, bounds, date-time, and union semantics', () => {
    const document = generateContractOpenApi()
    const schema = document.components?.schemas?.ContractProof
    expect(schema).toMatchObject({
      type: 'object',
      required: ['count', 'requiredNullable', 'occurredAt', 'event'],
      properties: {
        count: { type: 'integer', format: 'int32', minimum: 0, maximum: 2_147_483_647 },
        requiredNullable: { type: 'string', nullable: true },
        optionalValue: { type: 'string' },
        occurredAt: { type: 'string', format: 'date-time', pattern: 'Z$' },
      },
    })
    expect(document.paths['/internal/contracts/proof']?.get?.parameters).toContainEqual({
      in: 'header',
      name: 'x-internal-secret',
      required: true,
      schema: { minLength: 1, type: 'string' },
    })
    expect(document.components?.schemas?.ContractProofEvent).toMatchObject({
      discriminator: { propertyName: 'kind' },
      oneOf: expect.any(Array),
    })
  })

  test('regenerates the committed OpenAPI document without a diff', async () => {
    const committed = await Bun.file(resolve(import.meta.dir, '../openapi/contract-proof.openapi.json')).text()
    expect(serializeContractOpenApi(generateContractOpenApi())).toBe(committed)
  })
})
