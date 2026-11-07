export interface BhApiSearchResult {
  brawlhalla_id: number
  name: string
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

// v1 types (keyless API, additive)

export interface BhV1Guild {
  guild_id: number
  name: string
  create_date: number
  xp: number | string
  legacy_xp: number | string
  notice: string
  tags: string[]
  discord_invite_code: string
  guild_points: number | string
  rank?: number
  is_recruiting: boolean
  member_count?: number
}

export interface BhV1GuildMember {
  brawlhalla_id: number
  name: string
  rank: string
  join_date: number
  xp: number | string
  guild_points: number | string
}

export interface BhV1GuildMembers {
  guild_id: number
  guild_members: BhV1GuildMember[]
}

export type V1Mode = 'all' | 'ranked_1v1' | 'ranked_3v3'
