#!/bin/sh
set -eu

secrets_root=${BRAWLTOME_SECRETS_ROOT:-/run/secrets}
owner_password_file=$secrets_root/postgres_owner_password
operator_password_file=$secrets_root/postgres_dead_letter_password

[ -r "$owner_password_file" ] || {
  printf '%s\n' 'Required PostgreSQL owner password is unreadable.' >&2
  exit 1
}
[ -r "$operator_password_file" ] || {
  printf '%s\n' 'Required PostgreSQL dead-letter password is unreadable.' >&2
  exit 1
}

PGPASSWORD=$(cat "$owner_password_file")
DEAD_LETTER_PASSWORD=$(cat "$operator_password_file")
[ -n "$PGPASSWORD" ] || {
  printf '%s\n' 'Required PostgreSQL owner password is empty.' >&2
  exit 1
}
case "$DEAD_LETTER_PASSWORD" in
  *[!A-Za-z0-9_+=/-]*|'')
    printf '%s\n' 'PostgreSQL dead-letter password must use base64-safe characters.' >&2
    exit 1
    ;;
esac
[ "${#DEAD_LETTER_PASSWORD}" -ge 32 ] || {
  printf '%s\n' 'PostgreSQL dead-letter password must contain at least 32 characters.' >&2
  exit 1
}
POSTGRES_DEAD_LETTER_PASSWORD_FILE=$operator_password_file
export PGPASSWORD POSTGRES_DEAD_LETTER_PASSWORD_FILE

psql --set ON_ERROR_STOP=1 <<'SQL'
\set dead_letter_password `cat "$POSTGRES_DEAD_LETTER_PASSWORD_FILE"`

SELECT format(
  'CREATE ROLE brawltome_dead_letter LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'dead_letter_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brawltome_dead_letter')
\gexec

ALTER ROLE brawltome_dead_letter PASSWORD :'dead_letter_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA refresh_operations FROM brawltome_dead_letter;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA refresh_operations FROM brawltome_dead_letter;
REVOKE ALL PRIVILEGES ON SCHEMA refresh_operations FROM brawltome_dead_letter;

SELECT format('GRANT CONNECT ON DATABASE %I TO brawltome_dead_letter', current_database())
\gexec
GRANT USAGE ON SCHEMA refresh_operations TO brawltome_dead_letter;
GRANT SELECT, INSERT, UPDATE ON refresh_operations.operations TO brawltome_dead_letter;
GRANT SELECT, INSERT ON refresh_operations.dead_letter_actions TO brawltome_dead_letter;
GRANT SELECT ON
  refresh_operations.attempts,
  refresh_operations.proof_effects,
  refresh_operations.interactive_refresh_effects,
  refresh_operations.leaderboard_effects,
  refresh_operations.statistics_collection_effects,
  refresh_operations.statistics_publication_effects,
  refresh_operations.statistics_legend_meta_publication_effects,
  refresh_operations.schedule_occurrences,
  refresh_operations.schedules,
  refresh_operations.statistics_collection_seals
TO brawltome_dead_letter;
SQL
