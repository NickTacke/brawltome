import type { Database } from '@brawltome/foundation'

export type DeepCrawlProgressRow = { windowAt: Date; nextPage: number; totalPages: number }

export type SaveDeepCrawlProgressInput = DeepCrawlProgressRow & { mode: string; region: string }

type ProgressColumns = { window_at: Date; next_page: number; total_pages: number }

// 1v1 progress stays in the original per-region table; the other modes use the per-mode table
export async function readDeepCrawlProgress(
  database: Database,
  mode: string,
  region: string,
): Promise<DeepCrawlProgressRow | null> {
  const client = database.sql

  const [row] =
    mode === '1v1'
      ? await client<ProgressColumns[]>`
          SELECT window_at, next_page, total_pages
          FROM rankings.leaderboard_deep_crawl_progress WHERE region = ${region}
        `
      : await client<ProgressColumns[]>`
          SELECT window_at, next_page, total_pages
          FROM rankings.leaderboard_deep_crawl_mode_progress WHERE mode = ${mode} AND region = ${region}
        `

  return row ? { windowAt: row.window_at, nextPage: row.next_page, totalPages: row.total_pages } : null
}

export async function saveDeepCrawlProgress(database: Database, input: SaveDeepCrawlProgressInput): Promise<void> {
  const client = database.sql

  if (input.mode === '1v1') {
    await client`
      INSERT INTO rankings.leaderboard_deep_crawl_progress (region, window_at, next_page, total_pages)
      VALUES (${input.region}, ${input.windowAt}, ${input.nextPage}, ${input.totalPages})
      ON CONFLICT (region) DO UPDATE SET
        window_at = EXCLUDED.window_at, next_page = EXCLUDED.next_page,
        total_pages = EXCLUDED.total_pages, updated_at = clock_timestamp()
    `

    return
  }

  await client`
    INSERT INTO rankings.leaderboard_deep_crawl_mode_progress
      (mode, region, window_at, next_page, total_pages)
    VALUES (${input.mode}, ${input.region}, ${input.windowAt}, ${input.nextPage}, ${input.totalPages})
    ON CONFLICT (mode, region) DO UPDATE SET
      window_at = EXCLUDED.window_at, next_page = EXCLUDED.next_page,
      total_pages = EXCLUDED.total_pages, updated_at = clock_timestamp()
  `
}
