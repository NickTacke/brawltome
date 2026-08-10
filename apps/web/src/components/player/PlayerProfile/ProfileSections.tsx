'use client'

import { Card, CardContent } from '@brawltome/ui'
import { CombatCard } from '../CombatCard'
import { LegendSection } from '../LegendSection'
import { RankedCard } from '../RankedCard'
import { RatingChart } from '../RatingChart'
import { TeamSection } from '../TeamSection'
import { WeaponSection } from '../WeaponSection'
import type { PlayerData } from '../shared'

interface ProfileSectionsProps {
  player: PlayerData
  id: string
  allLegends: PlayerData[]
  rankedTeams: PlayerData[]
  // biome-ignore lint/suspicious/noExplicitAny: weapon stats inferred type
  weaponStats: any[]
}

export function ProfileSections({ player, id, allLegends, rankedTeams, weaponStats }: ProfileSectionsProps) {
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

      <section aria-labelledby="career-statistics-heading" className="space-y-6">
        <h2 id="career-statistics-heading" className="text-2xl font-bold text-foreground">
          Career Statistics
        </h2>
        <CombatCard player={player} />

        <div id="weapons">
          <WeaponSection weaponStats={weaponStats} />
        </div>

        <div id="legends">
          <LegendSection allLegends={allLegends} rankedLegends={[]} />
        </div>
      </section>
    </>
  )
}
