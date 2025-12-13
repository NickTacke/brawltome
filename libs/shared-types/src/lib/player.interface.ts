// Player interface for the database
export interface PlayerDTO {
  brawlhalla_id: number;
  name: string;
  region: string;

  // Ranked stats
  rating: number;
  peak_rating: number;
  tier: string;
  games: number;
  wins: number;

  // Legend stats
  best_legend: number;
  best_legend_games: number;
  best_legend_wins: number;
}

// Player Ranked Statistics
export interface PlayerRankedDTO {
  name: string;
  brawlhalla_id: number;
  rating: number;
  peak_rating: number;
  tier: string;
  wins: number;
  games: number;
  region: string;
  global_rank: number;
  region_rank: number;
  legends: PlayerRankedLegendDTO[];
  "2v2": PlayerRankedTeamDTO[];
}

export interface PlayerRankedLegendDTO {
  legend_id: number;
  legend_name_key: string;
  rating: number;
  peak_rating: number;
  tier: string;
  wins: number;
  games: number;
}

export interface PlayerRankedTeamDTO {
  brawlhalla_id_one: number;
  brawlhalla_id_two: number;
  rating: number;
  peak_rating: number;
  tier: string;
  wins: number;
  games: number;
  teamname: string;
}

// /rankings/2v2/:region/:page response row
export interface Ranked2v2TeamDTO {
  rank: number;
  teamname: string;
  brawlhalla_id_one: number;
  brawlhalla_id_two: number;
  rating: number;
  tier: string;
  wins: number;
  games: number;
  region: string;
  peak_rating: number;
}

// Player General Statistics
export interface PlayerStatsDTO {
  brawlhalla_id: number;
  name: string;
  xp: number;
  level: number;
  xp_percentage: number;
  games: number;
  wins: number;
  
  // Gadget damage
  damagebomb: string;
  damagemine: string;
  damagespikeball: string;
  damagesidekick: string;

  // Gadget hits / kills
  hitsnowball: number;
  kobomb: number;
  komine: number;
  kospikeball: number;
  kosidekick: number;
  kosnowball: number;

  legends: PlayerStatsLegendDTO[];
  clan?: PlayerClanDTO;
}

export interface PlayerStatsLegendDTO {
  legend_id: number;
  legend_name_key: string;
  
  // XP information
  xp: number;
  level: number;
  xp_percentage: number;

  // General statistics
  games: number;
  wins: number;
  matchtime: number;
  kos: number;
  teamkos: number;
  suicides: number;
  falls: number;
  damagedealt: string;
  damagetaken: string;

  // Weapon statistics
  damageweaponone: string;
  damageweapontwo: string;
  timeheldweaponone: number;
  timeheldweapontwo: number;
  koweaponone: number;
  koweapontwo: number;

  // Specific KO/Damage statistics
  kounarmed: number;
  kothrownitem: number;
  kogadgets: number;
  damageunarmed: string;
  damagethrownitem: string;
  damagegadgets: string;
}

export interface PlayerClanDTO {
  clan_name: string;
  clan_id: number;
  clan_xp: string;
  clan_lifetime_xp: number;
  personal_xp: number;
}
