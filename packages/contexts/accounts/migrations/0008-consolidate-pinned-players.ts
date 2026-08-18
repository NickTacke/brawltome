const sql = `ALTER TABLE accounts.saved_players RENAME TO pinned_players;
ALTER TABLE accounts.pinned_players RENAME COLUMN saved_at TO pinned_at;

WITH ordered AS (
  SELECT
    players.account_id,
    players.brawlhalla_id,
    row_number() OVER (
      PARTITION BY players.account_id
      ORDER BY
        (pins.position IS NULL),
        pins.position NULLS LAST,
        players.position,
        players.brawlhalla_id
    )::integer - 1 AS position
  FROM accounts.pinned_players players
  LEFT JOIN accounts.saved_player_pins pins
    ON pins.account_id = players.account_id
   AND pins.brawlhalla_id = players.brawlhalla_id
)
UPDATE accounts.pinned_players players
SET position = ordered.position
FROM ordered
WHERE players.account_id = ordered.account_id
  AND players.brawlhalla_id = ordered.brawlhalla_id;

DROP TRIGGER accounts_primary_players_remove_pin ON accounts.primary_players;
DROP FUNCTION accounts.remove_primary_player_pin();
DROP TRIGGER accounts_saved_player_pins_identity_immutable ON accounts.saved_player_pins;
DROP FUNCTION accounts.prevent_saved_player_pin_identity_update();
DROP TRIGGER accounts_saved_player_pins_reject_primary ON accounts.saved_player_pins;
DROP FUNCTION accounts.enforce_saved_player_pin_not_primary();
DROP TRIGGER accounts_saved_player_pins_compact ON accounts.saved_player_pins;
DROP FUNCTION accounts.compact_saved_player_pins();
DROP TABLE accounts.saved_player_pins;
`

export const consolidatePinnedPlayers = {
  identity: 'accounts/0008',
  predecessor: 'accounts/0007',
  checksum: '2493655cff4a59b208c34e2ac3634b55cbceadea35e60f01cf8add75a4b04d3d',
  sql,
} as const
