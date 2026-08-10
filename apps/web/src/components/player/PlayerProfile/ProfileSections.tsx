'use client'

import { Card, CardContent } from '@brawltome/ui'
import { CareerStatistics } from '../CareerStatistics'
import { RankedCard } from '../RankedCard'
import { RatingChart } from '../RatingChart'
import { TeamSection } from '../TeamSection'
import type { PlayerData } from '../shared'

interface ProfileSectionsProps {
  player: PlayerData
  id: string
  rankedTeams: PlayerData[]
  careerRefreshing: boolean
}

export function ProfileSections({ player, id, rankedTeams, careerRefreshing }: ProfileSectionsProps) {
  return (
    <>
      <section id="ranked" aria-labelledby="current-season-heading" className="space-y-6">
        <h2 id="current-season-heading" className="text-2xl font-bold text-foreground">
          Current Season
        </h2>
        <RankedCard player={player} rankedTeams={rankedTeams} />

        {player.rankedLegends?.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xl font-bold text-foreground">Ranked Legends</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {player.rankedLegends.map((legend: PlayerData) => (
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
          </div>
        )}

        {player.ratingHistory && player.ratingHistory.length > 0 && (
          <div id="rating-history">
            <RatingChart data={player.ratingHistory} />
          </div>
        )}

        <div id="teams">
          <TeamSection player={player} rankedTeams={rankedTeams} id={id} />
        </div>
      </section>

      <CareerStatistics career={player.career ?? null} refreshing={careerRefreshing} />
    </>
  )
}
