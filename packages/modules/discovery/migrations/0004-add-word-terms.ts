// Player names are also indexed by the start of each word, so a search finds "ó ¡pefura" by "pefura". Widened NOT VALID;
// discovery/0005 validates.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE discovery.terms DROP CONSTRAINT terms_term_kind_check;
ALTER TABLE discovery.terms
  ADD CONSTRAINT terms_term_kind_check CHECK (term_kind IN ('canonical', 'segment', 'alias', 'word')) NOT VALID;`

export const addWordTerms = {
  identity: 'discovery/0004',
  predecessor: 'discovery/0003',
  checksum: 'b2d7e1e6ae88d37d8a7058c12c60142868fa324ba34bfe0364f2739ee617a3b5',
  sql,
} as const
