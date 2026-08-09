import { z } from './zod'

export const accountSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().min(1).max(64),
    avatarUrl: z.string().url().nullable(),
    createdAt: z.string().datetime({ offset: false }),
  })
  .strict()

export const anonymousAccountViewSchema = z.object({ status: z.literal('anonymous') }).strict()
export const signedInAccountViewSchema = z
  .object({
    status: z.literal('signedIn'),
    account: accountSchema,
  })
  .strict()

export const accountViewSchema = z.discriminatedUnion('status', [anonymousAccountViewSchema, signedInAccountViewSchema])

export type AccountContract = z.infer<typeof accountSchema>
export type AccountViewContract = z.infer<typeof accountViewSchema>

export function parseAccountViewOutput(value: unknown): AccountViewContract {
  return accountViewSchema.parse(value)
}
