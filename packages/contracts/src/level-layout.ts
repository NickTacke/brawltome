import { z } from './zod'

// a stage as the game lays it out, in level units: the same shape brawlhalla-anims writes into its map files

const levelBoundsSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict()

// soft lines are the platforms a player can drop through
const levelSegmentSchema = z
  .object({ fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number(), isSoft: z.boolean() })
  .strict()

// a piece of platform art: the file under the map route, where its top left goes, its drawn size and its turn in
// degrees
const levelArtSchema = z
  .object({
    file: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    rotation: z.number(),
  })
  .strict()

export const levelLayoutSchema = z
  .object({
    // what the game's camera shows of the stage
    camera: levelBoundsSchema,
    // a player who leaves this box is out
    killBounds: levelBoundsSchema,
    collisions: z.array(levelSegmentSchema),
    art: z.array(levelArtSchema),
    background: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'LevelLayout' })

export type LevelBounds = z.infer<typeof levelBoundsSchema>
export type LevelSegment = z.infer<typeof levelSegmentSchema>
export type LevelArt = z.infer<typeof levelArtSchema>
export type LevelLayout = z.infer<typeof levelLayoutSchema>
