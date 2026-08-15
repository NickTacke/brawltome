import { aggregateRichWeaponStats } from '@/lib/weapon-aggregation'
import type { PlayerCareerProfileContract, PlayerRankedProfileContract } from '@brawltome/contracts'
import { getLegendById, normalizeWeaponName } from '@brawltome/game-data'
import { CombatCard } from '../CombatCard'
import { LegendSection } from '../LegendSection'
import { RankedCard } from '../RankedCard'
import { RatingChart } from '../RatingChart'
import { TeamSection } from '../TeamSection'
import { WeaponSection } from '../WeaponSection'
import type { PlayerData } from '../shared'
import { ProfileHeader } from './ProfileHeader'

export interface CanonicalPlayerProfileView {
  brawlhallaId: number
  name: string
  bestLegendNameKey?: string | null
  legacyRating?: number | null
  aliases: string[]
  clan: { clanId: number; clanName: string } | null
  currentSeason: PlayerRankedProfileContract | null
  career: PlayerCareerProfileContract | null
}

interface PlayerProfileHierarchyProps {
  player: CanonicalPlayerProfileView
  refreshing: boolean
  careerRefreshing: boolean
}

function careerLegends(player: CanonicalPlayerProfileView): PlayerData[] {
  if (!player.career?.snapshot) return []
  return player.career.snapshot.legends.map((legend) => {
    const reference = getLegendById(legend.legendId)
    return {
      ...legend,
      bioName: legend.legendNameKey,
      weaponOne: reference ? normalizeWeaponName(reference.weaponOne) : null,
      weaponTwo: reference ? normalizeWeaponName(reference.weaponTwo) : null,
      timeHeldWeaponOne: legend.weaponOne.heldTime,
      timeHeldWeaponTwo: legend.weaponTwo.heldTime,
      koWeaponOne: legend.weaponOne.kos,
      koWeaponTwo: legend.weaponTwo.kos,
      koUnarmed: legend.unarmed.kos,
      damageWeaponOne: legend.weaponOne.damage,
      damageWeaponTwo: legend.weaponTwo.damage,
      damageUnarmed: legend.unarmed.damage,
    }
  })
}

function rankedTeams(profile: PlayerRankedProfileContract | null) {
  const snapshot = profile?.snapshot
  if (!snapshot) return []
  return [
    ...snapshot.fixedTeams,
    ...snapshot.soloQueue.map((team) => ({
      ...team,
      brawlhallaIdOne: profile.brawlhallaId,
      brawlhallaIdTwo: 0 as const,
    })),
  ].sort((left, right) => right.rating - left.rating)
}

function v2Player(player: CanonicalPlayerProfileView, legends: PlayerData[]): PlayerData {
  const ranked = player.currentSeason?.snapshot
  const career = player.career?.snapshot
  const oneVsOne = ranked?.oneVsOne
  return {
    brawlhallaId: player.brawlhallaId,
    name: player.name,
    aliases: player.aliases,
    clan: player.clan,
    region: oneVsOne?.region ?? null,
    rating: oneVsOne?.rating ?? null,
    legacyRating: player.legacyRating ?? null,
    peakRating: oneVsOne?.peakRating ?? null,
    tier: oneVsOne?.tier ?? null,
    rankedGames: oneVsOne?.games,
    rankedWins: oneVsOne?.wins,
    rankedLastUpdated: player.currentSeason?.lastSuccessAt ?? null,
    ratingHistory: ranked?.ratingHistory ?? [],
    rankedLegends: ranked?.rankedLegends ?? [],
    xp: career?.account.xp ?? null,
    level: career?.account.level ?? null,
    xpPercentage: career?.account.xpPercentage ?? null,
    totalGames: career?.combat.games,
    totalWins: career?.combat.wins,
    matchTimeTotal: career?.combat.matchTime ?? 0,
    statsLastUpdated: career ? (player.career?.lastSuccessAt ?? null) : null,
    statsLegends: legends,
  }
}

export function PlayerProfileHierarchy({ player, refreshing }: PlayerProfileHierarchyProps) {
  const allLegends = careerLegends(player).sort((left, right) => (right.xp ?? 0) - (left.xp ?? 0))
  const rankedLegends = player.currentSeason?.snapshot?.rankedLegends ?? []
  const teams = rankedTeams(player.currentSeason)
  const display = v2Player(player, allLegends)
  const weaponStats = aggregateRichWeaponStats(allLegends, rankedLegends)
  const topLegend = player.career?.snapshot
    ? (allLegends[0] ??
      (player.currentSeason?.snapshot?.mainLegend
        ? { legendNameKey: player.currentSeason.snapshot.mainLegend.legendNameKey }
        : null))
    : player.bestLegendNameKey
      ? { legendNameKey: player.bestLegendNameKey }
      : (allLegends[0] ??
        (player.currentSeason?.snapshot?.mainLegend
          ? { legendNameKey: player.currentSeason.snapshot.mainLegend.legendNameKey }
          : null))

  return (
    <>
      <ProfileHeader
        player={player}
        topLegend={topLegend}
        aliases={player.aliases.toSorted((left, right) => left.localeCompare(right))}
        refreshing={refreshing}
      />

      <div id="ranked" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RankedCard player={display} rankedTeams={teams} />
        <CombatCard player={display} />
      </div>

      <div id="rating-history">
        {display.ratingHistory.length > 1 ? (
          <RatingChart data={display.ratingHistory} />
        ) : (
          <p className="text-sm text-muted-foreground">Rating history will appear after two complete observations.</p>
        )}
      </div>

      <div id="weapons">
        {weaponStats.length > 0 ? (
          <WeaponSection weaponStats={weaponStats} />
        ) : (
          <p className="text-sm text-muted-foreground">No weapon statistics are available yet.</p>
        )}
      </div>

      <div id="legends">
        {allLegends.length > 0 ? (
          <LegendSection
            allLegends={allLegends}
            rankedLegends={rankedLegends}
            rankedAvailable={Boolean(player.currentSeason?.snapshot)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No legend statistics are available yet.</p>
        )}
      </div>

      <div id="teams">
        {teams.length > 0 ? (
          <TeamSection
            player={{ name: player.name, rankedLastUpdated: player.currentSeason?.lastSuccessAt ?? null }}
            rankedTeams={teams}
            brawlhallaId={player.brawlhallaId}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No ranked 2v2 teams are available yet.</p>
        )}
      </div>
    </>
  )
}
