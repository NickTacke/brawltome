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
    region: varchar('region', { length: 16 }),
    globalRank: integer('global_rank'),
  },
  (t) => [
    primaryKey({ columns: [t.brawlhallaId, t.brawlhallaIdOne, t.brawlhallaIdTwo] }),
    index('idx_ranked_team_rating').on(t.rating),
    index('idx_ranked_team_region_rating').on(t.region, t.rating),
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
    bioQuoteFromAttrib: varchar('bio_quote_from_attrib', { length: 256 }),
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
// Discord Link
// ============================================================

export const discordLink = pgTable(
  'discord_link',
  {
    discordId: varchar('discord_id', { length: 64 }).primaryKey(),
    brawlhallaId: integer('brawlhalla_id')
      .notNull()
      .references(() => player.brawlhallaId, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('idx_discord_link_bhid').on(t.brawlhallaId)],
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
