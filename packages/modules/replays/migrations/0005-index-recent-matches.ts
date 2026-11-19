// the recent matches list reads the newest stored matches that weren't merged into another, page by page
const sql = `CREATE INDEX replays_matches_recent_idx ON replays.matches (parsed_at DESC, id DESC) WHERE merged_into IS NULL;
`

export const indexRecentMatches = {
  identity: 'replays/0005',
  predecessor: 'replays/0004',
  checksum: 'd1ceba9b820d353e693a7cb6d38d4774421466f1c8f6582faafb3518b87fd5f8',
  requires: [],
  sql,
} as const
