const sql = `CREATE TABLE clans.discovery_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  source_version bigint NOT NULL DEFAULT 0 CHECK (source_version >= 0)
);
INSERT INTO clans.discovery_state DEFAULT VALUES;

CREATE TABLE clans.discovery_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id integer NOT NULL CHECK (clan_id > 0),
  source_version bigint NOT NULL CHECK (source_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz
);
CREATE INDEX clans_discovery_outbox_pending
  ON clans.discovery_outbox (created_at, event_id) WHERE delivered_at IS NULL;

CREATE FUNCTION clans.enqueue_profile_discovery_fact() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  next_version bigint;
BEGIN
  UPDATE clans.discovery_state
  SET source_version = source_version + 1
  WHERE singleton
  RETURNING source_version INTO next_version;

  INSERT INTO clans.discovery_outbox (clan_id, source_version)
  VALUES (COALESCE(NEW.clan_id, OLD.clan_id), next_version);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER clans_profiles_discovery_outbox_write
AFTER INSERT OR DELETE ON clans.profiles
FOR EACH ROW EXECUTE FUNCTION clans.enqueue_profile_discovery_fact();
CREATE TRIGGER clans_profiles_discovery_outbox_update
AFTER UPDATE OF clan_name, clan_xp ON clans.profiles
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION clans.enqueue_profile_discovery_fact();

CREATE FUNCTION clans.enqueue_membership_discovery_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  next_version bigint;
BEGIN
  UPDATE clans.discovery_state
  SET source_version = source_version + 1
  WHERE singleton
  RETURNING source_version INTO next_version;

  INSERT INTO clans.discovery_outbox (clan_id, source_version)
  SELECT DISTINCT clan_id, next_version
  FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.clan_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.clan_id END
  ]) AS clan_id
  WHERE clan_id IS NOT NULL;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER clans_members_discovery_outbox_write
AFTER INSERT OR DELETE ON clans.members
FOR EACH ROW EXECUTE FUNCTION clans.enqueue_membership_discovery_facts();
CREATE TRIGGER clans_members_discovery_outbox_transfer
AFTER UPDATE OF clan_id ON clans.members
FOR EACH ROW WHEN (OLD.clan_id IS DISTINCT FROM NEW.clan_id)
EXECUTE FUNCTION clans.enqueue_membership_discovery_facts();

DO $$
DECLARE
  bootstrap_version bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM clans.profiles) THEN
    UPDATE clans.discovery_state
    SET source_version = source_version + 1
    WHERE singleton
    RETURNING source_version INTO bootstrap_version;

    INSERT INTO clans.discovery_outbox (clan_id, source_version)
    SELECT clan_id, bootstrap_version FROM clans.profiles;
  END IF;
END;
$$;`

export const addClanDiscoveryFacts = {
  identity: 'clans/0002',
  predecessor: 'clans/0001',
  checksum: 'a2a148ba624a2b44f8efbebc8fd6026ef5e6fabbce7870acab7acb43e6353037',
  sql,
} as const
