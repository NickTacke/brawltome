// no CASCADE: if anything outside these tables still depends on them, the migration fails before dropping any.
// the triggers player 0005 put on public.player and public.player_alias go with their tables; their function
// players.enqueue_discovery_fact() stays, the players tables use it too
const sql = `SET LOCAL lock_timeout = '5s';
SET LOCAL client_min_messages = warning;

DROP TABLE IF EXISTS
  public.clan,
  public.clan_member,
  public.legend,
  public.match_events,
  public.match_players,
  public.matches,
  public.oauth_account,
  public.player,
  public.player_alias,
  public.player_clan,
  public.player_link,
  public.player_ranked_legend,
  public.player_ranked_team,
  public.player_stats_legend,
  public.player_weapon_stat,
  public.rating_history,
  public.session,
  public."user";

DROP TABLE IF EXISTS drizzle.__drizzle_migrations;
DROP SCHEMA IF EXISTS drizzle;
`

export const dropV2Tables = {
  identity: 'legacy-v2/0001',
  predecessor: null,
  checksum: '230cf88088e970b9d360b63d8042bc587d05f721228e66198197058774f34e4a',
  sql,
} as const
