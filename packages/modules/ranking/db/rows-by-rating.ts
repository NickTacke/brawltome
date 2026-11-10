import type { Sql } from '@brawltome/foundation'

/**
 * One snapshot's rows, each with `rating_standing`: its place on the whole board by rating. Brawlhalla's regional
 * boards list some higher ratings below lower ones, so their official rank is not what we show. A rating tie goes to
 * more wins, as the game ranks it, and then keeps the official order. `snapshotId` is an id, or a fragment naming a
 * column of the query around it.
 */
export function rowsByRating(sql: Sql, snapshotId: string | ReturnType<Sql>) {
  return sql`
    SELECT row.*, (row_number() OVER (ORDER BY row.rating DESC, row.wins DESC, row.ordinal))::integer AS rating_standing
    FROM rankings.snapshot_rows row
    WHERE row.snapshot_id = ${snapshotId}
  `
}
