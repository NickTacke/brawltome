import { clanIdSchema, decimalXpSchema } from './clan'
import { brawlhallaIdSchema, playerNameSchema } from './player-reference'
import { z } from './zod'

export const discoverySearchInputSchema = z.object({ query: z.string().max(100) }).strict()

export const discoveryPlayerHitSchema = z
  .object({
    brawlhallaId: brawlhallaIdSchema,
    name: playerNameSchema,
    region: z.string().nullable(),
    rating: z.number().int().nonnegative().nullable(),
    viewCount: z.number().int().nonnegative(),
    bestLegendNameKey: z.string().nullable(),
    matchedAlias: playerNameSchema.nullable(),
  })
  .strict()

export const discoveryClanHitSchema = z
  .object({
    clanId: clanIdSchema,
    clanName: z.string().min(1),
    clanXp: decimalXpSchema,
    memberCount: z.number().int().nonnegative(),
  })
  .strict()

export const discoverySearchOutputSchema = z
  .object({
    players: z.array(discoveryPlayerHitSchema).max(40),
    clans: z.array(discoveryClanHitSchema).max(5),
  })
  .strict()

export type DiscoveryPlayerHitContract = z.infer<typeof discoveryPlayerHitSchema>
export type DiscoveryClanHitContract = z.infer<typeof discoveryClanHitSchema>
export type DiscoverySearchOutputContract = z.infer<typeof discoverySearchOutputSchema>
