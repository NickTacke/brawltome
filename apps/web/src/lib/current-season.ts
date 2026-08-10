import type { PlayerRankedProfileContract } from '@brawltome/contracts'

export function applyCurrentSeason<TPlayer extends Record<string, unknown>>(
  player: TPlayer,
  currentSeason: PlayerRankedProfileContract | null,
) {
  const snapshot = currentSeason?.snapshot
  if (!snapshot) {
    return {
      ...player,
      region: null,
      rating: null,
      peakRating: null,
      tier: null,
      rankedWins: null,
      rankedGames: null,
      bestLegend: null,
      bestLegendNameKey: null,
      rankedLegends: [],
      rankedTeams: [],
      ratingHistory: [],
      rankedLastUpdated: currentSeason?.lastSuccessAt ?? null,
      currentSeason,
    }
  }

  return {
    ...player,
    region: snapshot.oneVsOne.region,
    rating: snapshot.oneVsOne.rating,
    peakRating: snapshot.oneVsOne.peakRating,
    tier: snapshot.oneVsOne.tier,
    rankedWins: snapshot.oneVsOne.wins,
    rankedGames: snapshot.oneVsOne.games,
    bestLegend: snapshot.mainLegend?.legendId ?? null,
    bestLegendNameKey: snapshot.mainLegend?.legendNameKey ?? null,
    rankedLegends: snapshot.rankedLegends,
    rankedTeams: [
      ...snapshot.fixedTeams,
      ...snapshot.soloQueue.map((solo) => ({
        ...solo,
        brawlhallaIdOne: currentSeason.brawlhallaId,
        brawlhallaIdTwo: solo.secondPlayerId,
      })),
    ],
    ratingHistory: snapshot.ratingHistory,
    rankedLastUpdated: currentSeason.lastSuccessAt,
    currentSeason,
  }
}
