// no released code uses the old names any more. each drop locks only the view or function it names, so the tables
// behind them and refresh_operations.operations are not touched
const sql = `SET LOCAL lock_timeout = '5s';

DROP VIEW refresh_operations.leaderboard_effects;
DROP VIEW refresh_operations.leaderboard_deep_crawl_progress;
DROP VIEW refresh_operations.leaderboard_deep_crawl_mode_progress;

DROP FUNCTION refresh_operations.record_leaderboard_effect(uuid, text, text, text, bigint);`

export const dropEffectTableCompatibility = {
  identity: 'rankings/0014',
  predecessor: 'rankings/0013',
  requires: ['refresh-operations/0028'],
  checksum: 'd2de38e34775f7ea2b1797c12f41a7c63f926bae3851fa12e7acd60f04a6273c',
  sql,
} as const
