import type { PlayerCareerProfileContract, PlayerRankedProfileContract } from '@brawltome/contracts'
import { Card, CardContent } from '@brawltome/ui'
import { CareerStatistics } from '../CareerStatistics'
import { RatingChart } from '../RatingChart'
import { type RankedTeam, TeamSection } from '../TeamSection'

interface ProfileSectionsProps {
  identity: { brawlhallaId: number; name: string }
  currentSeason: PlayerRankedProfileContract | null
  career: PlayerCareerProfileContract | null
  rankedTeams: RankedTeam[]
  careerRefreshing: boolean
}

function missingDetailExplanation(snapshot: NonNullable<PlayerRankedProfileContract['snapshot']>, hasTeams: boolean) {
  const missing = [
    snapshot.rankedLegends.length === 0 ? 'ranked legends' : null,
    snapshot.ratingHistory.length < 2 ? 'rating history' : null,
    !hasTeams ? 'ranked teams' : null,
  ].filter((label): label is string => label !== null)

  if (missing.length === 0) return null
  if (missing.length === 3) {
    return 'No ranked legends, rating history, or ranked teams were observed. Unsupported deep sections are omitted.'
  }
  const last = missing.pop()
  return `${missing.length > 0 ? `${missing.join(', ')} or ` : ''}${last} were not observed and are omitted.`
}

export function ProfileSections({
  identity,
  currentSeason,
  career,
  rankedTeams,
  careerRefreshing,
}: ProfileSectionsProps) {
  const snapshot = currentSeason?.snapshot
  const hasRankedLegends = Boolean(snapshot?.rankedLegends.length)
  const hasRatingHistory = (snapshot?.ratingHistory.length ?? 0) >= 2
  const hasTeams = rankedTeams.length > 0
  const hasDeepDetails = hasRankedLegends || hasRatingHistory || hasTeams
  const missingDetails = snapshot ? missingDetailExplanation(snapshot, hasTeams) : null

  return (
    <>
      <section id="current-season" aria-labelledby="current-season-heading" className="space-y-4">
        <div className="space-y-2">
          <h2 id="current-season-heading" className="text-2xl font-bold text-foreground">
            Current Season
          </h2>
          <p className="text-sm text-muted-foreground">
            Seasonal ranked details from complete BrawlTome observations. Sparse pulse coverage is qualified in the
            competitive snapshot above.
          </p>
          {!snapshot ? (
            <p className="text-sm text-muted-foreground">No additional Current Season details are available.</p>
          ) : (
            missingDetails && <p className="text-sm text-muted-foreground">{missingDetails}</p>
          )}
        </div>

        {snapshot && hasDeepDetails && (
          <details className="group rounded-lg border border-border bg-card">
            <summary className="cursor-pointer rounded-lg px-4 py-3 font-semibold text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              Explore Current Season details
            </summary>
            <div className="space-y-8 border-t border-border p-4 sm:p-6">
              {hasRankedLegends && (
                <section aria-labelledby="ranked-legends-heading" className="space-y-3">
                  <h3 id="ranked-legends-heading" className="text-xl font-bold text-foreground">
                    Ranked Legends
                  </h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {snapshot.rankedLegends.map((legend) => (
                      <Card key={legend.legendId}>
                        <CardContent className="pt-6 flex items-center justify-between gap-4">
                          <div>
                            <p className="font-bold capitalize">{legend.legendNameKey}</p>
                            <p className="text-sm text-muted-foreground">
                              {legend.wins} wins in {legend.games} games
                            </p>
                          </div>
                          <p className="font-mono font-bold">
                            {legend.rating} / {legend.peakRating} peak
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {hasRatingHistory && (
                <div id="rating-history">
                  <RatingChart data={snapshot.ratingHistory} />
                </div>
              )}

              {hasTeams && (
                <div id="teams">
                  <TeamSection
                    player={{ name: identity.name, rankedLastUpdated: currentSeason.lastSuccessAt }}
                    rankedTeams={rankedTeams}
                    brawlhallaId={identity.brawlhallaId}
                  />
                </div>
              )}
            </div>
          </details>
        )}
      </section>

      <CareerStatistics career={career} refreshing={careerRefreshing} />
    </>
  )
}
