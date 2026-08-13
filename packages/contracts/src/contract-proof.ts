import { z } from './zod'

const int32 = z.int().min(0).max(2_147_483_647).meta({ format: 'int32' })

export const contractProofEventSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('ready'), attempt: int32 }).strict(),
    z.object({ kind: z.literal('failed'), message: z.string().min(1) }).strict(),
  ])
  .meta({ id: 'ContractProofEvent', discriminator: { propertyName: 'kind' } })

export const contractProofSchema = z
  .object({
    count: int32,
    requiredNullable: z.string().nullable(),
    optionalValue: z.string().optional(),
    occurredAt: z.iso
      .datetime({ offset: false })
      .regex(/Z$/, 'date-time must use the UTC Z suffix')
      .meta({ format: 'date-time' }),
    event: contractProofEventSchema,
  })
  .strict()
  .meta({ id: 'ContractProof' })

export type ContractProof = z.infer<typeof contractProofSchema>

export function parseContractProofOutput(value: unknown): ContractProof {
  return contractProofSchema.parse(value)
}

export function createContractProof(): ContractProof {
  return {
    count: 0,
    requiredNullable: null,
    occurredAt: '2026-01-01T00:00:00Z',
    event: { kind: 'ready', attempt: 0 },
  }
}
