export interface BhApiSearchResult {
  brawlhalla_id: number
  name: string
}

export interface BhApiRanking1v1 {
  rank: number
  name: string
  brawlhalla_id: number
  best_legend: number
  best_legend_games: number
  best_legend_wins: number
  rating: number
  tier: string
  games: number
  wins: number
  region: string
  peak_rating: number
}

export interface BhApiRanking2v2 {
  rank: number
  teamname: string
  brawlhalla_id_one: number
  brawlhalla_id_two: number
  rating: number
  tier: string
  wins: number
  games: number
  region: string
  peak_rating: number
}

export interface BhApiPlayerStats {
  brawlhalla_id: number
  name: string
  xp: number
  level: number
  xp_percentage: number
  games: number
  wins: number
  damagebomb: string
  damagemine: string
  damagespikeball: string
  damagesidekick: string
  hitsnowball: number
  kobomb: number
  komine: number
  kospikeball: number
  kosidekick: number
  kosnowball: number
  legends: BhApiStatsLegend[]
  clan?: BhApiPlayerClan
}

export interface BhApiStatsLegend {
  legend_id: number
  legend_name_key: string
  damagedealt: string
  damagetaken: string
  kos: number
  falls: number
  suicides: number
  teamkos: number
  matchtime: number
  games: number
  wins: number
  damageunarmed: string
  damagethrownitem: string
  damageweaponone: string
  damageweapontwo: string
  damagegadgets: string
  kounarmed: number
  kothrownitem: number
  koweaponone: number
  koweapontwo: number
  kogadgets: number
  timeheldweaponone: number
  timeheldweapontwo: number
  xp: number
  level: number
  xp_percentage: number
}

export interface BhApiPlayerClan {
  clan_name: string
  clan_id: number
  clan_xp: string
  clan_lifetime_xp: number
  personal_xp: number
}

export interface BhApiPlayerRanked {
  name: string
  brawlhalla_id: number
  rating: number
  peak_rating: number
  tier: string
  wins: number
  games: number
  region: string
  global_rank: number
  region_rank: number
  legends: BhApiRankedLegend[]
  '2v2': BhApiRankedTeam[]
}

export interface BhApiRankedLegend {
  legend_id: number
  legend_name_key: string
  rating: number
  peak_rating: number
  tier: string
  wins: number
  games: number
}

export interface BhApiRankedTeam {
  brawlhalla_id_one: number
  brawlhalla_id_two: number
  rating: number
  peak_rating: number
  tier: string
  wins: number
  games: number
  teamname: string
  region: number
  global_rank: number
}

export interface BhApiClan {
  clan_id: number
  clan_name: string
  clan_create_date: number
  clan_xp: string
  clan_lifetime_xp: number
  clan: BhApiClanMember[]
}

export interface BhApiClanMember {
  brawlhalla_id: number
  name: string
  rank: string
  join_date: number
  xp: number
}

export interface BhApiLegend {
  legend_id: number
  legend_name_key: string
  bio_name: string
  bio_aka: string
  weapon_one: string
  weapon_two: string
  strength: string
  dexterity: string
  defense: string
  speed: string
}

export interface BhApiLegendFull extends BhApiLegend {
  bio_quote: string
  bio_quote_about_attrib: string
  bio_quote_from: string
  bio_quote_from_attrib: string
  bio_text: string
  bot_name: string
}

export type Bracket = '1v1' | '2v2' | 'kungfoot' | 'rotating'
export type Region = 'us-e' | 'eu' | 'sea' | 'brz' | 'aus' | 'us-w' | 'jpn' | 'me' | 'sa' | 'all'

// v1 types (keyless API, additive)

export interface BhV1RegionRank {
  region: string
  rank: number
}

export interface BhV1StatsLegend {
  legend_id: number
  games: number
  wins: number
  damage_dealt: number
  damage_taken: number
  kos: number
  falls: number
  suicides: number
  team_kos: number
  match_time: number
  damage_unarmed: number
  damage_thrown_item: number
  damage_weapon_one: number
  damage_weapon_two: number
  damage_gadgets: number
  ko_unarmed: number
  ko_weapon_one: number
  ko_weapon_two: number
  ko_gadgets: number
  ko_thrown_item?: number
  time_held_weapon_one: number
  time_held_weapon_two: number
  xp?: number
  level?: number
  xp_percentage?: number
}

export interface BhV1PlayerStatsAll {
  brawlhalla_id: number
  name: string
  games: number
  wins: number
  damage_bomb: number
  damage_mine: number
  damage_spikeball: number
  damage_sidekick: number
  hit_snowball: number
  ko_bomb: number
  ko_mine: number
  ko_sidekick: number
  ko_snowball: number
  ko_spikeball: number
  region_ranks: BhV1RegionRank[]
  legends: BhV1StatsLegend[]
  xp?: number
  level?: number
  xp_percentage?: number
}

export interface BhV1RankedLegend {
  legend_id: number
  games: number
  wins: number
  rating: number
  peak_rating: number
  tier: string
}

export interface BhV1PlayerStatsRanked {
  brawlhalla_id: number
  name: string
  games: number
  wins: number
  rating: number
  peak_rating: number
  tier: string
  region: string
  region_ranks: BhV1RegionRank[]
  global_rank?: number
  legends: BhV1RankedLegend[]
}

export interface BhV1Team {
  brawlhalla_id_one: number
  brawlhalla_id_two: number
  username_one: string
  username_two: string
  rating: number
  peak_rating: number
  tier: string
  wins: number
  games: number
  region: string
  region_ranks: BhV1RegionRank[]
  global_rank: number
}

export interface BhV1PlayerTeams {
  brawlhalla_id: number
  teams: { ranked_2v2: BhV1Team[] }
}

export interface BhV1Guild {
  guild_id: number
  name: string
  create_date: number
  xp: number
  legacy_xp: number
  notice: string
  tags: string[]
  discord_invite_code: string
  guild_points: number
  rank?: number
  is_recruiting: boolean
  member_count?: number
}

export interface BhV1GuildMembership {
  guild_id: number
  guild_name: string
  personal_xp: number
  personal_xp_this_week: number
  personal_points: number
  join_date: number
  rank: string
}
export interface BhV1PlayerGuild {
  brawlhalla_id: number
  guild: BhV1GuildMembership
}

export interface BhV1GuildMember {
  brawlhalla_id: number
  name: string
  rank: string
  join_date: number
  xp: number
  guild_points: number
}

export interface BhV1GuildMembers {
  guild_id: number
  guild_members: BhV1GuildMember[]
}

export interface BhV1Legend {
  legend_id: number
  legend_name: string
  bio_name: string
  bio_aka: string
  bio_quote: string
  bio_quote_about_attrib: string
  bio_quote_from: string
  bio_quote_from_attrib: string
  bio_text: string
  bot_name: string
  weapon_one: string
  weapon_two: string
  strength: number
  dexterity: number
  defense: number
  speed: number
}

export interface BhV1LegendsPage {
  legends: BhV1Legend[]
  total_pages: number
}

export type V1Mode = 'all' | 'ranked_1v1' | 'ranked_3v3'
