// a stock match's stats dump has no score, only a timed match's has one. dropping NOT NULL is safe while the old
// release still serves: it always writes a score
const sql = `ALTER TABLE replays.match_players ALTER COLUMN score DROP NOT NULL;
`

export const allowNoScore = {
  identity: 'replays/0004',
  predecessor: 'replays/0003',
  checksum: 'f1006762241da4ca32f249f4249971d473e1482cc76404454ab82a42fa811ad9',
  requires: [],
  sql,
} as const
