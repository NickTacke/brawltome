#!/bin/sh
set -eu

runtime_password_file=/run/secrets/postgres_runtime_password
[ -r "$runtime_password_file" ] || {
  printf '%s\n' 'Required PostgreSQL runtime password is unreadable.' >&2
  exit 1
}
runtime_password=$(cat "$runtime_password_file")
[ -n "$runtime_password" ] || {
  printf '%s\n' 'Required PostgreSQL runtime password is empty.' >&2
  exit 1
}

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set runtime_password="$runtime_password" <<'SQL'
SELECT format(
  'CREATE ROLE brawltome_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brawltome_runtime')
\gexec

ALTER ROLE brawltome_runtime PASSWORD :'runtime_password';
REVOKE TEMPORARY ON DATABASE brawltome FROM PUBLIC;
GRANT CONNECT ON DATABASE brawltome TO brawltome_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO brawltome_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE brawltome_owner
  GRANT USAGE ON SCHEMAS TO brawltome_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE brawltome_owner
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brawltome_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE brawltome_owner
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO brawltome_runtime;
SQL
