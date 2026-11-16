import { brawlhallaIdSchema } from './player-reference'
import { z } from './zod'

// none of the objects below is strict: within v1 fields are only ever added, and generated clients must accept them
export const desktopVersionHeader = 'x-desktop-version'

// 0.2.0 or 0.2.0-beta.1
export const desktopVersionSchema = z.string().regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}(-[0-9A-Za-z.-]{1,20})?$/)

const int32 = z.int().min(0).max(2_147_483_647).meta({ format: 'int32' })

const utcDateTime = z.iso
  .datetime({ offset: false })
  .regex(/Z$/, 'date-time must use the UTC Z suffix')
  .meta({ format: 'date-time' })

const maxLobbyPlayers = 4

export const desktopUpdateRequiredSchema = z
  .object({ minimumVersion: desktopVersionSchema })
  .meta({ id: 'DesktopUpdateRequired' })

export const desktopStandingSchema = z.object({
  rating: int32,
  peakRating: int32,
  tier: z.string().min(1).nullable(),
  wins: int32,
  games: int32,
})

// not registered as a component: zod-to-openapi turns a nullable use of a registered schema into a nullable
// component, and Progenitor then generates a newtype instead of Option<T>
const nullableStanding = desktopStandingSchema.nullable()

export const desktopLobbyInputSchema = z
  .object({
    matchType: z.enum(['1v1', '2v2']),
    players: z
      .array(z.object({ brawlhallaId: brawlhallaIdSchema, team: int32 }))
      .min(1)
      .max(maxLobbyPlayers),
  })
  .refine(
    (lobby) => new Set(lobby.players.map((player) => player.brawlhallaId)).size === lobby.players.length,
    'a player can only appear once in a lobby',
  )
  .meta({ id: 'DesktopLobbyInput' })

const desktopLobbyPlayerSchema = z
  .object({
    brawlhallaId: brawlhallaIdSchema,
    name: z.string().nullable(),
    known: z.boolean(),
    oneVsOne: nullableStanding,
    region: z.string().nullable(),
    regionRank: int32.min(1).nullable(),
    refreshedAt: utcDateTime.nullable(),
    // a refresh of this player was queued, so the app may send the same lobby once more for newer numbers
    isRefreshing: z.boolean(),
  })
  .meta({ id: 'DesktopLobbyPlayer' })

const desktopLobbyCardSchema = z
  .object({
    team: int32,
    players: z.array(desktopLobbyPlayerSchema).min(1),
    teamStanding: nullableStanding,
  })
  .meta({ id: 'DesktopLobbyCard' })

export const desktopLobbySchema = z.object({ cards: z.array(desktopLobbyCardSchema) }).meta({ id: 'DesktopLobby' })

export type DesktopLobbyInputContract = z.infer<typeof desktopLobbyInputSchema>
export type DesktopLobbyContract = z.infer<typeof desktopLobbySchema>
export type DesktopStandingContract = z.infer<typeof desktopStandingSchema>

export function parseDesktopLobbyOutput(value: unknown): DesktopLobbyContract {
  return desktopLobbySchema.parse(value)
}
