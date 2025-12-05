// Player interface for the database
export interface Player {
  id: string;
  brawlhallaId: number;
  name: string;
  rating: number;
  tier: string;
  wins: number;
  viewCount: number;
  lastUpdated: Date;
  lastViewedAt: Date;
}