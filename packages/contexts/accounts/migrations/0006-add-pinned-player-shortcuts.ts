const sql = `CREATE TABLE accounts.saved_player_pins (
  account_id uuid NOT NULL,
  brawlhalla_id bigint NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 3),
  pinned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, brawlhalla_id),
  CONSTRAINT accounts_saved_player_pins_saved_player_fk
    FOREIGN KEY (account_id, brawlhalla_id)
    REFERENCES accounts.saved_players(account_id, brawlhalla_id)
    ON DELETE CASCADE,
  CONSTRAINT accounts_saved_player_pins_account_position_unique
    UNIQUE (account_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION accounts.prevent_saved_player_pin_identity_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_id <> OLD.account_id OR NEW.brawlhalla_id <> OLD.brawlhalla_id THEN
    RAISE EXCEPTION 'Saved Player pin identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_saved_player_pins_identity_immutable
BEFORE UPDATE OF account_id, brawlhalla_id
ON accounts.saved_player_pins
FOR EACH ROW
EXECUTE FUNCTION accounts.prevent_saved_player_pin_identity_update();

CREATE FUNCTION accounts.enforce_saved_player_pin_not_primary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account:' || NEW.account_id::text, 0));
  IF EXISTS (
    SELECT 1
    FROM accounts.primary_players primary_player
    WHERE primary_player.account_id = NEW.account_id
      AND primary_player.brawlhalla_id = NEW.brawlhalla_id
  ) THEN
    RAISE EXCEPTION 'Primary Player cannot occupy a saved-player pin';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_saved_player_pins_reject_primary
AFTER INSERT
ON accounts.saved_player_pins
FOR EACH ROW
EXECUTE FUNCTION accounts.enforce_saved_player_pin_not_primary();

CREATE FUNCTION accounts.compact_saved_player_pins()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  WITH compacted AS (
    SELECT brawlhalla_id, row_number() OVER (ORDER BY position, brawlhalla_id)::integer - 1 AS position
    FROM accounts.saved_player_pins
    WHERE account_id = OLD.account_id
  )
  UPDATE accounts.saved_player_pins pins
  SET position = compacted.position
  FROM compacted
  WHERE pins.account_id = OLD.account_id
    AND pins.brawlhalla_id = compacted.brawlhalla_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER accounts_saved_player_pins_compact
AFTER DELETE
ON accounts.saved_player_pins
FOR EACH ROW
EXECUTE FUNCTION accounts.compact_saved_player_pins();

CREATE FUNCTION accounts.lock_primary_player_shortcuts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account:' || NEW.account_id::text, 0));
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_primary_players_lock_shortcuts
BEFORE INSERT OR UPDATE OF account_id, brawlhalla_id
ON accounts.primary_players
FOR EACH ROW
EXECUTE FUNCTION accounts.lock_primary_player_shortcuts();

CREATE FUNCTION accounts.remove_primary_player_pin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM accounts.saved_player_pins
  WHERE account_id = NEW.account_id
    AND brawlhalla_id = NEW.brawlhalla_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_primary_players_remove_pin
AFTER INSERT OR UPDATE OF account_id, brawlhalla_id
ON accounts.primary_players
FOR EACH ROW
EXECUTE FUNCTION accounts.remove_primary_player_pin();
`

export const addPinnedPlayerShortcuts = {
  identity: 'accounts/0006',
  predecessor: 'accounts/0005',
  checksum: '153a908615bca450f16942247159921befe1fcd6759bc781ec7141334dc256aa',
  sql,
} as const
