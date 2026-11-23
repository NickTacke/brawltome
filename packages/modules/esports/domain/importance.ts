import { type OfficialSeries, officialSeries } from './event-names'

// how deep the run went; the steps shrink further down because one set separates 5th from 7th but a whole bracket
// separates 1st from 5th. below top 8 a finish never leads the cards, so it scores nothing
const placementPoints: ReadonlyMap<number, number> = new Map([
  [1, 100],
  [2, 75],
  [3, 60],
  [4, 50],
  [5, 40],
  [6, 40],
  [7, 32],
  [8, 32],
])

// bcx draws the best of every region, so a top 8 there outweighs a podium almost anywhere else
const worldChampionshipWeight = 3
// the seasonal championships and midseason are each region's best, and they decide the bcx seeds
const seasonalChampionshipWeight = 2
// trials, partner events like ceo or dreamhack, and qualifiers have a strong field but less at stake
const otherOfficialWeight = 1.5
// community events are open brackets that top players often skip
const communityWeight = 1
// an in-person bracket means travel and a stage, which only the players who mean it make it to
const inPersonWeight = 1.25

const seriesWeights = {
  'world-championship': worldChampionshipWeight,
  'seasonal-championship': seasonalChampionshipWeight,
  other: otherOfficialWeight,
} satisfies Record<OfficialSeries, number>

export type ScoredFinish = { placement: number; fullName: string; isOfficial: boolean; isOnline: boolean }

// community events are told apart by brawltools' flag only, an organiser can name a cup "Winter Championship"
export function eventWeight(fullName: string, isOfficial: boolean): number {
  if (!isOfficial) return communityWeight

  return seriesWeights[officialSeries(fullName)]
}

/**
 * How much a finish counts for the esports cards: placement points times the event's weight, a quarter more in
 * person. A BCX 7th (96) beats a Galaxy Cup 3rd (60), and a seasonal Champs 3rd (120) beats both.
 */
export function importance(finish: ScoredFinish): number {
  const points = placementPoints.get(finish.placement) ?? 0
  const venueWeight = finish.isOnline ? 1 : inPersonWeight

  return points * eventWeight(finish.fullName, finish.isOfficial) * venueWeight
}
