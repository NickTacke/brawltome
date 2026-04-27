'use client'

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
      <div id="ranked" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RankedCard player={player} rankedTeams={rankedTeams} />
        <CombatCard player={player} />
      </div>

      {player.ratingHistory && player.ratingHistory.length > 0 && (
        <div id="rating-history">
          <RatingChart data={player.ratingHistory} />
        </div>
      )}

      <div id="weapons">
        <WeaponSection weaponStats={weaponStats} />
      </div>

      <div id="legends">
        <LegendSection allLegends={allLegends} rankedLegends={player.rankedLegends || []} />
      </div>

      <div id="teams">
        <TeamSection player={player} rankedTeams={rankedTeams} id={id} />
      </div>
    </>
  )
}
