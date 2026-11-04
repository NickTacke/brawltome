// Validates the check discovery/0004 added NOT VALID, under SHARE UPDATE EXCLUSIVE in its own transaction.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE discovery.terms VALIDATE CONSTRAINT terms_term_kind_check;`

export const validateWordTerms = {
  identity: 'discovery/0005',
  predecessor: 'discovery/0004',
  checksum: 'c1c8332237e709eb834327b6a41e7e5ee77811d7baf0171768b922b18a6c00a5',
  sql,
} as const
