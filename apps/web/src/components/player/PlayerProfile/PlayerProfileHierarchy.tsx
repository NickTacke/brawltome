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
  aliases?: Array<{ value?: unknown }>
  clan?: { clanId: number; clanName: string } | null
  xp?: number | null
  level?: number | null
  xpPercentage?: number | null
  totalGames?: number | null
  totalWins?: number | null
  matchTimeTotal?: number | null
  statsLastUpdated?: Date | string | null
  statsLegends?: PlayerData[]
  currentSeason: PlayerRankedProfileContract | null
  career: PlayerCareerProfileContract | null
}

interface PlayerProfileHierarchyProps {
  player: CanonicalPlayerProfileView
  refreshing: boolean
  careerRefreshing: boolean
}

function displayAliases(player: CanonicalPlayerProfileView): string[] {
  return (player.aliases ?? [])
    .map((alias) => alias.value)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .filter((value) => value.trim() !== player.name)
    .sort((left, right) => left.localeCompare(right))
}

function careerLegends(player: CanonicalPlayerProfileView): PlayerData[] {
  if (!player.career?.snapshot) return [...(player.statsLegends ?? [])]
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
    aliases: player.aliases ?? [],
    clan: player.clan ?? null,
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
    xp: career ? career.account.xp : (player.xp ?? null),
    level: career ? career.account.level : (player.level ?? null),
    xpPercentage: career ? career.account.xpPercentage : (player.xpPercentage ?? null),
    totalGames: career ? career.combat.games : (player.totalGames ?? undefined),
    totalWins: career ? career.combat.wins : (player.totalWins ?? undefined),
    matchTimeTotal: career ? career.combat.matchTime : (player.matchTimeTotal ?? 0),
    statsLastUpdated: career ? (player.career?.lastSuccessAt ?? null) : (player.statsLastUpdated ?? null),
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
      <ProfileHeader player={player} topLegend={topLegend} aliases={displayAliases(player)} refreshing={refreshing} />

      <div id="ranked" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RankedCard player={display} rankedTeams={teams} />
        <CombatCard player={display} />
      </div>

      {display.ratingHistory.length > 1 && (
        <div id="rating-history">
          <RatingChart data={display.ratingHistory} />
        </div>
      )}

      <div id="weapons">
        <WeaponSection weaponStats={weaponStats} />
      </div>

      <div id="legends">
        <LegendSection
          allLegends={allLegends}
          rankedLegends={rankedLegends}
          rankedAvailable={Boolean(player.currentSeason?.snapshot)}
        />
      </div>

      <div id="teams">
        <TeamSection
          player={{ name: player.name, rankedLastUpdated: player.currentSeason?.lastSuccessAt ?? null }}
          rankedTeams={teams}
          brawlhallaId={player.brawlhallaId}
        />
      </div>
    </>
  )
}
