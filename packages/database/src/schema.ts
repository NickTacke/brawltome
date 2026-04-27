import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const refreshTierEnum = pgEnum('refresh_tier', ['hot', 'warm', 'cold'])

// ============================================================
// Player
// ============================================================

export const player = pgTable(
  'player',
  {
    brawlhallaId: integer('brawlhalla_id').primaryKey(),
    name: varchar('name', { length: 256 }).notNull(),
    region: varchar('region', { length: 16 }),

    // Ranked
    rating: integer('rating').default(0).notNull(),
    peakRating: integer('peak_rating').default(0),
    tier: varchar('tier', { length: 64 }),
    rankedGames: integer('ranked_games').default(0).notNull(),
    rankedWins: integer('ranked_wins').default(0).notNull(),
    rankedLastUpdated: timestamp('ranked_last_updated'),

    // Best legend
    bestLegend: integer('best_legend').default(0),
    bestLegendGames: integer('best_legend_games').default(0),
    bestLegendWins: integer('best_legend_wins').default(0),

    // Stats (merged from playerStats)
    xp: integer('xp'),
    level: integer('level'),
    xpPercentage: real('xp_percentage'),
    totalGames: integer('total_games'),
    totalWins: integer('total_wins'),
    matchTimeTotal: integer('match_time_total').default(0),
    damageBomb: bigint('damage_bomb', { mode: 'bigint' }),
    damageMine: bigint('damage_mine', { mode: 'bigint' }),
    damageSpikeball: bigint('damage_spikeball', { mode: 'bigint' }),
    damageSidekick: bigint('damage_sidekick', { mode: 'bigint' }),
    hitSnowball: integer('hit_snowball'),
    koBomb: integer('ko_bomb'),
    koMine: integer('ko_mine'),
    koSpikeball: integer('ko_spikeball'),
    koSidekick: integer('ko_sidekick'),
    koSnowball: integer('ko_snowball'),
    statsLastUpdated: timestamp('stats_last_updated'),
    valhallanConfirmedAt: timestamp('valhallan_confirmed_at'),

    // Metadata
    lastUpdated: timestamp('last_updated').defaultNow().notNull(),
    viewCount: integer('view_count').default(0).notNull(),
    lastViewedAt: timestamp('last_viewed_at').defaultNow().notNull(),
    refreshTier: refreshTierEnum('refresh_tier').default('cold').notNull(),
  },
  (t) => [
    index('idx_player_name').on(t.name),
    index('idx_player_view_count').on(t.viewCount),
    index('idx_player_rating').on(t.rating),
    index('idx_player_peak_rating').on(t.peakRating),
    index('idx_player_wins').on(t.rankedWins),
    index('idx_player_games').on(t.rankedGames),
    index('idx_player_region_rating').on(t.region, t.rating),
    index('idx_player_region_peak_rating').on(t.region, t.peakRating),
    index('idx_player_region_wins').on(t.region, t.rankedWins),
    index('idx_player_region_games').on(t.region, t.rankedGames),
  ],
)

// ============================================================
// Player Alias
// ============================================================

export const playerAlias = pgTable(
  'player_alias',
  {
    brawlhallaId: integer('brawlhalla_id')
      .notNull()
      .references(() => player.brawlhallaId, { onDelete: 'cascade' }),
    key: varchar('key', { length: 256 }).notNull(),
    value: varchar('value', { length: 256 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.brawlhallaId, t.key] }), index('idx_alias_key').on(t.key)],
)

// ============================================================
// Player Stats Legend
// ============================================================

export const playerStatsLegend = pgTable(
  'player_stats_legend',
  {
    brawlhallaId: integer('brawlhalla_id')
      .notNull()
      .references(() => player.brawlhallaId, { onDelete: 'cascade' }),
    legendId: integer('legend_id').notNull(),
    legendNameKey: varchar('legend_name_key', { length: 64 }).notNull(),

    xp: integer('xp').notNull(),
    level: integer('level').notNull(),
    xpPercentage: real('xp_percentage').notNull(),

    games: integer('games').notNull(),
    wins: integer('wins').notNull(),
    matchTime: integer('match_time').notNull(),
    kos: integer('kos').notNull(),
    teamKos: integer('team_kos').notNull(),
    suicides: integer('suicides').notNull(),
    falls: integer('falls').notNull(),
    damageDealt: bigint('damage_dealt', { mode: 'bigint' }).notNull(),
    damageTaken: bigint('damage_taken', { mode: 'bigint' }).notNull(),

    damageWeaponOne: bigint('damage_weapon_one', { mode: 'bigint' }).notNull(),
    damageWeaponTwo: bigint('damage_weapon_two', { mode: 'bigint' }).notNull(),
    timeHeldWeaponOne: integer('time_held_weapon_one').notNull(),
    timeHeldWeaponTwo: integer('time_held_weapon_two').notNull(),
    koWeaponOne: integer('ko_weapon_one').notNull(),
    koWeaponTwo: integer('ko_weapon_two').notNull(),

    koUnarmed: integer('ko_unarmed').notNull(),
    koThrownItem: integer('ko_thrown_item').notNull(),
    koGadgets: integer('ko_gadgets').notNull(),
    damageUnarmed: bigint('damage_unarmed', { mode: 'bigint' }).notNull(),
    damageThrownItem: bigint('damage_thrown_item', { mode: 'bigint' }).notNull(),
    damageGadgets: bigint('damage_gadgets', { mode: 'bigint' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.brawlhallaId, t.legendId] })],
)

// ============================================================
// Player Clan (from stats endpoint)
// ============================================================

export const playerClan = pgTable('player_clan', {
  brawlhallaId: integer('brawlhalla_id')
    .primaryKey()
    .references(() => player.brawlhallaId, { onDelete: 'cascade' }),
  clanName: varchar('clan_name', { length: 256 }).notNull(),
  clanId: integer('clan_id').notNull(),
  clanXp: bigint('clan_xp', { mode: 'bigint' }).notNull(),
  clanLifetimeXp: bigint('clan_lifetime_xp', { mode: 'bigint' }).notNull(),
  personalXp: integer('personal_xp').notNull(),
})

// ============================================================
// Player Weapon Stat (aggregated across legends)
// ============================================================

export const playerWeaponStat = pgTable(
  'player_weapon_stat',
  {
    brawlhallaId: integer('brawlhalla_id')
      .notNull()
      .references(() => player.brawlhallaId, { onDelete: 'cascade' }),
    weapon: varchar('weapon', { length: 64 }).notNull(),
    timeHeld: integer('time_held').notNull(),
    damage: bigint('damage', { mode: 'bigint' }).notNull(),
    kos: integer('kos').notNull(),
  },
  (t) => [primaryKey({ columns: [t.brawlhallaId, t.weapon] })],
)

// ============================================================
// Player Ranked Legend
// ============================================================

export const playerRankedLegend = pgTable(
  'player_ranked_legend',
  {
    brawlhallaId: integer('brawlhalla_id')
      .notNull()
      .references(() => player.brawlhallaId, { onDelete: 'cascade' }),
    legendId: integer('legend_id').notNull(),
    legendNameKey: varchar('legend_name_key', { length: 64 }).notNull(),
    rating: integer('rating').notNull(),
    peakRating: integer('peak_rating').notNull(),
    tier: varchar('tier', { length: 64 }).notNull(),
    wins: integer('wins').notNull(),
    games: integer('games').notNull(),
  },
  (t) => [primaryKey({ columns: [t.brawlhallaId, t.legendId] })],
)

// ============================================================
// Player Ranked Team
// ============================================================

export const playerRankedTeam = pgTable(
  'player_ranked_team',
  {
    brawlhallaId: integer('brawlhalla_id')
      .notNull()
      .references(() => player.brawlhallaId, { onDelete: 'cascade' }),
    brawlhallaIdOne: integer('brawlhalla_id_one').notNull(),
    brawlhallaIdTwo: integer('brawlhalla_id_two').notNull(),
    teamName: varchar('team_name', { length: 256 }).notNull(),
    rating: integer('rating').notNull(),
    peakRating: integer('peak_rating').notNull(),
    tier: varchar('tier', { length: 64 }).notNull(),
    wins: integer('wins').notNull(),
    games: integer('games').notNull(),
    region: varchar('region', { length: 16 }).notNull(),
    globalRank: integer('global_rank'),
    valhallanConfirmedAt: timestamp('valhallan_confirmed_at'),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.brawlhallaId, t.brawlhallaIdOne, t.brawlhallaIdTwo, t.region] }),
    index('idx_ranked_team_rating').on(t.rating),
    index('idx_ranked_team_region_rating').on(t.region, t.rating),
  ],
)

// ============================================================
// Player Rank 1v1
// ============================================================

export const playerRank1v1 = pgTable(
  'player_rank_1v1',
  {
    brawlhallaId: integer('brawlhalla_id')
      .notNull()
      .references(() => player.brawlhallaId, { onDelete: 'cascade' }),
    region: varchar('region', { length: 16 }).notNull(),
    rank: integer('rank').notNull(),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.brawlhallaId, t.region] }),
    uniqueIndex('uq_player_rank_1v1_region_rank').on(t.region, t.rank),
    index('idx_player_rank_1v1_synced_at').on(t.syncedAt),
  ],
)

// ============================================================
// Legend (static data)
// ============================================================

export const legend = pgTable(
  'legend',
  {
    legendId: integer('legend_id').primaryKey(),
    legendNameKey: varchar('legend_name_key', { length: 64 }).notNull(),
    bioName: varchar('bio_name', { length: 128 }).notNull(),
    bioAka: varchar('bio_aka', { length: 256 }),
    bioQuote: text('bio_quote'),
    bioQuoteAboutAttrib: varchar('bio_quote_about_attrib', { length: 256 }).notNull(),
    bioQuoteFrom: text('bio_quote_from'),
    bioQuoteFromAttrib: text('bio_quote_from_attrib'),
    bioText: text('bio_text'),
    botName: varchar('bot_name', { length: 128 }),
    weaponOne: varchar('weapon_one', { length: 64 }).notNull(),
    weaponTwo: varchar('weapon_two', { length: 64 }).notNull(),
    strength: varchar('strength', { length: 8 }).notNull(),
    dexterity: varchar('dexterity', { length: 8 }).notNull(),
    defense: varchar('defense', { length: 8 }).notNull(),
    speed: varchar('speed', { length: 8 }).notNull(),
  },
  (t) => [uniqueIndex('idx_legend_name_key').on(t.legendNameKey)],
)

// ============================================================
// Clan
// ============================================================

export const clan = pgTable('clan', {
  clanId: integer('clan_id').primaryKey(),
  clanName: varchar('clan_name', { length: 256 }).notNull(),
  clanCreateDate: timestamp('clan_create_date').notNull(),
  clanXp: bigint('clan_xp', { mode: 'bigint' }).notNull(),
  clanLifetimeXp: bigint('clan_lifetime_xp', { mode: 'bigint' }).notNull(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
})

export const clanMember = pgTable(
  'clan_member',
  {
    clanId: integer('clan_id')
      .notNull()
      .references(() => clan.clanId, { onDelete: 'cascade' }),
    brawlhallaId: integer('brawlhalla_id').notNull(),
    name: varchar('name', { length: 256 }).notNull(),
    rank: varchar('rank', { length: 64 }).notNull(),
    joinDate: timestamp('join_date').notNull(),
    xp: integer('xp').notNull(),
    legendNameKey: varchar('legend_name_key', { length: 64 }),
  },
  (t) => [primaryKey({ columns: [t.clanId, t.brawlhallaId] })],
)

// ============================================================
// Blacklist
// ============================================================

export const blacklist = pgTable('blacklist', {
  brawlhallaId: integer('brawlhalla_id').primaryKey(),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ============================================================
// Rating History
// ============================================================

export const ratingHistory = pgTable(
  'rating_history',
  {
    id: serial('id').primaryKey(),
    brawlhallaId: integer('brawlhalla_id')
      .notNull()
      .references(() => player.brawlhallaId, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    peakRating: integer('peak_rating').notNull(),
    tier: varchar('tier', { length: 64 }),
    games: integer('games').notNull(),
    wins: integer('wins').notNull(),
    recordedAt: timestamp('recorded_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_rating_history_player').on(t.brawlhallaId),
    index('idx_rating_history_time').on(t.brawlhallaId, t.recordedAt),
  ],
)

// ============================================================
// Identity
// ============================================================

export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const oauthAccount = pgTable(
  'oauth_account',
  {
    provider: varchar('provider', { length: 32 }).notNull(),
    providerAccountId: varchar('provider_account_id', { length: 64 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    username: varchar('username', { length: 64 }).notNull(),
    avatarHash: varchar('avatar_hash', { length: 128 }),
    refreshToken: text('refresh_token'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    uniqueIndex('uq_oauth_account_user_provider').on(t.userId, t.provider),
  ],
)

export const session = pgTable(
  'session',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_session_user_id').on(t.userId)],
)

export const playerLink = pgTable(
  'player_link',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    brawlhallaId: integer('brawlhalla_id'),
    steamId: varchar('steam_id', { length: 64 }).notNull(),
    linkedVia: varchar('linked_via', { length: 32 }).notNull().default('steam'),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    linkedAt: timestamp('linked_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_player_link_brawlhalla').on(t.brawlhallaId),
    uniqueIndex('uq_player_link_steam').on(t.steamId),
  ],
)

// ============================================================
// Matchmaking
// ============================================================

export const matchParseStatusEnum = pgEnum('match_parse_status', ['parsed', 'pending'])
export const matchEventKindEnum = pgEnum('match_event_kind', ['ko', 'self_destruct', 'victory_face'])
export const matchLinkSourceEnum = pgEnum('match_link_source', ['overlay_memory'])

export const matches = pgTable(
  'matches',
  {
    slug: text('slug').primaryKey(),
    dedupeHash: text('dedupe_hash'),
    uploadedBy: uuid('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
    parseStatus: matchParseStatusEnum('parse_status').default('pending').notNull(),
    formatVersion: integer('format_version'),
    replayStorageKey: text('replay_storage_key').notNull(),
    replayBytes: integer('replay_bytes').notNull(),
    gamePatch: text('game_patch'),
    randomSeed: bigint('random_seed', { mode: 'number' }),
    playlistId: integer('playlist_id'),
    playlistName: text('playlist_name'),
    onlineGame: integer('online_game'),
    levelId: integer('level_id'),
    durationMs: integer('duration_ms'),
    matchDurationMs: integer('match_duration_ms'),
    endOfMatchFanfareId: integer('end_of_match_fanfare_id'),
    winnerTeam: integer('winner_team'),
    scoringTypeId: integer('scoring_type_id'),
    detailedStatsKey: text('detailed_stats_key'),
    simVersion: integer('sim_version'),
    simRanAt: timestamp('sim_ran_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_matches_dedupe_hash').on(t.dedupeHash),
    index('idx_matches_uploaded_at').on(t.uploadedAt),
    index('idx_matches_parse_status').on(t.parseStatus),
    index('idx_matches_pending_format_version').on(t.formatVersion),
  ],
)

export const matchPlayers = pgTable(
  'match_players',
  {
    id: serial('id').primaryKey(),
    matchSlug: text('match_slug')
      .notNull()
      .references(() => matches.slug, { onDelete: 'cascade' }),
    replayEntityId: integer('replay_entity_id').notNull(),
    brawlhallaId: integer('brawlhalla_id'),
    linkSource: matchLinkSourceEnum('link_source'),
    displayName: varchar('display_name', { length: 256 }).notNull(),
    team: integer('team').notNull(),
    legendId: integer('legend_id'),
    costumeId: integer('costume_id'),
    stanceIndex: integer('stance_index'),
    weaponSkin1: integer('weapon_skin_1'),
    weaponSkin2: integer('weapon_skin_2'),
    colorSchemeId: integer('color_scheme_id'),
    companionId: integer('companion_id'),
    emitterId: integer('emitter_id'),
    trailEffectId: integer('trail_effect_id'),
    avatarId: integer('avatar_id'),
    isBot: integer('is_bot'),
    finalScore: integer('final_score'),
  },
  (t) => [
    uniqueIndex('uq_match_players_slug_entity').on(t.matchSlug, t.replayEntityId),
    index('idx_match_players_bhid').on(t.brawlhallaId),
  ],
)

export const matchEvents = pgTable(
  'match_events',
  {
    id: serial('id').primaryKey(),
    matchSlug: text('match_slug')
      .notNull()
      .references(() => matches.slug, { onDelete: 'cascade' }),
    entityId: integer('entity_id').notNull(),
    timestampMs: integer('timestamp_ms').notNull(),
    kind: matchEventKindEnum('kind').notNull(),
  },
  (t) => [index('idx_match_events_slug_ts').on(t.matchSlug, t.timestampMs)],
)
