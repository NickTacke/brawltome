import { Card } from '@/components/ui'
import type { PlayerCareerProfileContract, PlayerRankedProfileContract } from '@brawltome/contracts'
import { legendAvatarUrl } from '@brawltome/game-data'
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

export function ProfileSections({
  identity,
  currentSeason,
  career,
  rankedTeams,
  careerRefreshing,
}: ProfileSectionsProps) {
  const snapshot = currentSeason?.snapshot
  const hasRatingHistory = (snapshot?.ratingHistory.length ?? 0) >= 2
  const hasTeams = rankedTeams.length > 0

  return (
    <>
      <section id="current-season" aria-labelledby="current-season-heading" className="space-y-6">
        <h2 id="current-season-heading" className="text-2xl font-bold text-foreground">
          Current Season
        </h2>
        {snapshot?.rankedLegends.length ? (
          <section aria-labelledby="ranked-legends-heading" className="space-y-3">
            <h3 id="ranked-legends-heading" className="text-xl font-bold text-foreground">
              Ranked Legends
            </h3>
            <Card className="grid gap-px overflow-hidden bg-border sm:grid-cols-2">
              {snapshot.rankedLegends.map((legend) => (
                <div key={legend.legendId} className="flex items-center gap-3 bg-card p-4">
                  <img
                    src={legendAvatarUrl(legend.legendNameKey)}
                    alt=""
                    className="h-12 w-12 rounded-lg bg-muted object-cover object-top"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold capitalize text-foreground">{legend.legendNameKey}</p>
                    <p className="text-xs text-muted-foreground">
                      {legend.wins} wins in {legend.games} games
                    </p>
                  </div>
                  <p className="font-mono font-bold text-foreground">
                    {legend.rating} <span className="text-muted-foreground">/ {legend.peakRating}</span>
                  </p>
                </div>
              ))}
            </Card>
          </section>
        ) : snapshot ? (
          <p className="text-sm text-muted-foreground">No ranked legend games were observed.</p>
        ) : null}

        {hasRatingHistory ? (
          <div id="rating-history">
            <RatingChart data={snapshot?.ratingHistory ?? []} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Rating history will appear after two complete observations.</p>
        )}
      </section>

      <CareerStatistics career={career} currentSeason={currentSeason} refreshing={careerRefreshing} />

      {hasTeams && (
        <div id="teams">
          <TeamSection
            player={{ name: identity.name, rankedLastUpdated: currentSeason?.lastSuccessAt ?? null }}
            rankedTeams={rankedTeams}
            brawlhallaId={identity.brawlhallaId}
          />
        </div>
      )}
    </>
  )
}
