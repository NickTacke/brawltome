import type { PlayerBoardRanksContract, PlayerRankedProfileContract } from '@brawltome/contracts'

/** The game's API gives a player no ranks, so they are the player's places on our own 1v1 boards. */
export function withBoardRanks(
  profile: PlayerRankedProfileContract | null,
  boardRanks: PlayerBoardRanksContract | null,
): PlayerRankedProfileContract | null {
  if (!profile?.snapshot || !boardRanks) return profile

  const { globalRank, regionRank } = boardRanks
  const oneVsOne = { ...profile.snapshot.oneVsOne, globalRank, regionRank }

  return { ...profile, snapshot: { ...profile.snapshot, oneVsOne } }
}
