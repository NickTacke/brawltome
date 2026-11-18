import type { Sql } from '@brawltome/foundation'

/** The paths, once each, the art bucket doesn't hold yet: never uploaded, or an upload not finished. */
export async function unstoredArtPaths(sql: Sql, paths: string[]): Promise<string[]> {
  const uniquePaths = [...new Set(paths)]

  const stored = await sql<{ path: string }[]>`
    SELECT path FROM replays.art_files WHERE path = ANY(${uniquePaths}::text[]) AND state = 'stored'
  `

  const storedPaths = new Set(stored.map(({ path }) => path))

  return uniquePaths.filter((path) => !storedPaths.has(path))
}
