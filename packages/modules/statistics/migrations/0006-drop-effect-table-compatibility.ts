// no released code uses the old names any more. each drop locks only the view or function it names, so the tables
// behind them and refresh_operations.operations are not touched
const sql = `SET LOCAL lock_timeout = '5s';

DROP VIEW refresh_operations.statistics_collection_effects;
DROP VIEW refresh_operations.statistics_collection_seals;
DROP VIEW refresh_operations.statistics_publication_effects;
DROP VIEW refresh_operations.statistics_legend_meta_publication_effects;

DROP FUNCTION refresh_operations.record_statistics_collection_effect(uuid, text, text, text, bigint);
DROP FUNCTION refresh_operations.seal_statistics_collections_for_publication(uuid, uuid[]);
DROP FUNCTION refresh_operations.record_statistics_publication_effect(uuid, text, text, bigint, uuid[]);
DROP FUNCTION refresh_operations.record_statistics_legend_meta_publication_effect(uuid, text, text, bigint);`

export const dropEffectTableCompatibility = {
  identity: 'statistics/0006',
  predecessor: 'statistics/0005',
  requires: ['refresh-operations/0028'],
  checksum: 'a2ec2fec1e6d38b784dec02e9575008deb480f30062f9e65abad9ffe3fbb6313',
  sql,
} as const
