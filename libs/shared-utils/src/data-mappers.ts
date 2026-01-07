import type {
  PlayerRankedLegendDTO,
  PlayerRankedTeamDTO,
  PlayerStatsLegendDTO,
} from '@brawltome/shared-types';

/**
 * Mapped ranked legend data ready for database insertion
 */
export interface MappedRankedLegend {
  legendId: number;
  legendNameKey: string;
  rating: number;
  peakRating: number;
  tier: string;
  wins: number;
  games: number;
}

/**
 * Mapped team data ready for database insertion
 */
export interface MappedTeam {
  brawlhallaIdOne: number;
  brawlhallaIdTwo: number;
  teamName: string;
  rating: number;
  peakRating: number;
  tier: string;
  wins: number;
  games: number;
}

/**
 * Mapped stats legend data ready for database insertion
 */
export interface MappedStatsLegend {
  legendId: number;
  legendNameKey: string;
  xp: number;
  level: number;
  xpPercentage: number;
  games: number;
  wins: number;
  matchTime: number;
  KOs: number;
  teamKOs: number;
  suicides: number;
  falls: number;
  damageDealt: string;
  damageTaken: string;
  damageWeaponOne: string;
  damageWeaponTwo: string;
  timeHeldWeaponOne: number;
  timeHeldWeaponTwo: number;
  KOWeaponOne: number;
  KOWeaponTwo: number;
  KOUnarmed: number;
  KOThrownItem: number;
  KOGadgets: number;
  damageUnarmed: string;
  damageThrownItem: string;
  damageGadgets: string;
}

/**
 * Maps API ranked legend data to database format
 */
export function mapRankedLegends(
  legends: PlayerRankedLegendDTO[] | undefined | null
): MappedRankedLegend[] {
  if (!legends) return [];
  return legends.map((legend) => ({
    legendId: legend.legend_id,
    legendNameKey: legend.legend_name_key,
    rating: legend.rating,
    peakRating: legend.peak_rating,
    tier: legend.tier,
    wins: legend.wins,
    games: legend.games,
  }));
}

/**
 * Maps API team data to database format, deduplicating by ID pairs
 */
export function mapTeams(
  teams: PlayerRankedTeamDTO[] | undefined | null
): MappedTeam[] {
  if (!teams) return [];

  // Deduplicate teams based on ID pairs
  const uniqueTeams = new Map<string, PlayerRankedTeamDTO>();
  for (const team of teams) {
    const key = `${team.brawlhalla_id_one}-${team.brawlhalla_id_two}`;
    if (!uniqueTeams.has(key)) {
      uniqueTeams.set(key, team);
    }
  }

  return Array.from(uniqueTeams.values()).map((team) => ({
    brawlhallaIdOne: team.brawlhalla_id_one,
    brawlhallaIdTwo: team.brawlhalla_id_two,
    teamName: team.teamname,
    rating: team.rating,
    peakRating: team.peak_rating,
    tier: team.tier,
    wins: team.wins,
    games: team.games,
  }));
}

/**
 * Maps API stats legend data to database format, filtering out invalid entries
 */
export function mapStatsLegends(
  legends: PlayerStatsLegendDTO[] | undefined | null
): MappedStatsLegend[] {
  if (!legends) return [];
  return legends
    .filter((legend) => legend.legend_id !== 0)
    .map((legend) => ({
      legendId: legend.legend_id,
      legendNameKey: legend.legend_name_key,
      xp: legend.xp,
      level: legend.level,
      xpPercentage: legend.xp_percentage,
      games: legend.games,
      wins: legend.wins,
      matchTime: legend.matchtime,
      KOs: legend.kos,
      teamKOs: legend.teamkos,
      suicides: legend.suicides,
      falls: legend.falls,
      damageDealt: legend.damagedealt,
      damageTaken: legend.damagetaken,
      damageWeaponOne: legend.damageweaponone,
      damageWeaponTwo: legend.damageweapontwo,
      timeHeldWeaponOne: legend.timeheldweaponone,
      timeHeldWeaponTwo: legend.timeheldweapontwo,
      KOWeaponOne: legend.koweaponone,
      KOWeaponTwo: legend.koweapontwo,
      KOUnarmed: legend.kounarmed,
      KOThrownItem: legend.kothrownitem,
      KOGadgets: legend.kogadgets,
      damageUnarmed: legend.damageunarmed,
      damageThrownItem: legend.damagethrownitem,
      damageGadgets: legend.damagegadgets,
    }));
}
