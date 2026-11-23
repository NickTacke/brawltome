// bh-native records no timeline for a custom room, so there is no art to export for one. the column's default keeps
// the release still serving during a deploy working. the backfill marks the custom matches whose art already failed
// with no-animations; that failure on any other match stays, since its line claimed a timeline
const sql = `ALTER TABLE replays.matches ADD COLUMN has_timeline boolean NOT NULL DEFAULT true;

UPDATE replays.matches SET has_timeline = false, art_state = 'none', art_failure = NULL
WHERE is_custom AND art_state = 'failed' AND art_failure->>'code' = 'no-animations';
`

export const addHasTimeline = {
  identity: 'replays/0006',
  predecessor: 'replays/0005',
  checksum: '4764ab85ba1db0b82fab1b3592845dcd9eaa5960f9bc1260950c6f0028cbb3ca',
  requires: [],
  sql,
} as const
