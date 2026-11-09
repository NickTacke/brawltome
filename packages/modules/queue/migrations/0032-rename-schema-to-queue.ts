// the one migration that breaks the release still serving: its queue queries name the old schema until it is replaced
// the rename only updates a catalog row, and rewriting a function takes at most ACCESS SHARE on the tables its
// %ROWTYPE names, so neither step waits for a worker's row locks
// function bodies are stored as text and fail only when run. they are looked up rather than listed because a database
// can be built without the modules that own some of them
const sql = `SET LOCAL lock_timeout = '5s';

ALTER SCHEMA refresh_operations RENAME TO queue;

DO $$
DECLARE
  -- refresh_operations.ranking_retention_lease is a session setting, not a schema reference
  old_schema_reference constant text := '\\yrefresh_operations\\.(?!ranking_retention_lease\\y)';
  stored_function oid;
BEGIN
  FOR stored_function IN
    SELECT oid FROM pg_catalog.pg_proc WHERE prosrc ~ old_schema_reference
  LOOP
    EXECUTE pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(stored_function), old_schema_reference, 'queue.', 'g'
    );
  END LOOP;
END;
$$;`

export const renameSchemaToQueue = {
  identity: 'refresh-operations/0032',
  predecessor: 'refresh-operations/0031',
  checksum: 'a9cb9d5a2df7e24b2222979e2883ec60cc18d0851a7de66f0255984ce4539523',
  // statistics sorts after this migration, and its older migrations still name the old schema
  requiresIfPresent: ['accounts/0012', 'players/0022', 'rankings/0014', 'statistics/0006'],
  sql,
} as const
