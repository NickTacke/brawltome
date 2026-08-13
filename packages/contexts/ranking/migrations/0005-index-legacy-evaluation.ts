const sql = `SET LOCAL lock_timeout = '5s';

CREATE INDEX rankings_legacy_archive_region
  ON rankings.legacy_archive (source_table, (raw_row->>'region'));`

export const indexLegacyRankingEvaluation = {
  identity: 'rankings/0005',
  predecessor: 'rankings/0004',
  checksum: '132980558b772814805df6c30e807a57abfda519b4671b6818414835698c92a0',
  sql,
} as const
