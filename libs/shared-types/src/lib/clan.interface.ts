export interface ClanMemberDTO {
  brawlhalla_id: number;
  name: string;
  rank: string;
  join_date: number;
  xp: number;
}

export interface ClanDTO {
  clan_id: number;
  clan_name: string;
  clan_create_date: number;
  clan_xp: string;
  clan_lifetime_xp: number;
  clan: ClanMemberDTO[];
}
