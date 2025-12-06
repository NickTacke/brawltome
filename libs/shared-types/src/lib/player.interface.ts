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