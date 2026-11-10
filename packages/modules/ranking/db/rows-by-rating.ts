import type { Sql } from '@brawltome/foundation'

/**
 * One snapshot's rows, each with `rating_standing`: its place on the whole board by rating. Brawlhalla's regional
 * boards list some higher ratings below lower ones, so their official rank is not what we show. A tie keeps the
 * official order.
 */
export function rowsByRating(sql: Sql, snapshotId: string) {
  return sql`
    SELECT row.*, (row_number() OVER (ORDER BY row.rating DESC, row.ordinal))::integer AS rating_standing
    FROM rankings.snapshot_rows row
    WHERE row.snapshot_id = ${snapshotId}
  `
}
