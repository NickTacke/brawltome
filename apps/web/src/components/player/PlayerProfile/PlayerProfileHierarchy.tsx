import type { PlayerCareerProfileContract, PlayerRankedProfileContract } from '@brawltome/contracts'
import { RankedCard } from '../RankedCard'
import type { RankedTeam } from '../TeamSection'
import { ProfileHeader } from './ProfileHeader'
import { ProfileSections } from './ProfileSections'

export interface CanonicalPlayerProfileView {
  brawlhallaId: number
  name: string
  aliases?: Array<{ value?: unknown }>
  clan?: { clanId: number; clanName: string } | null
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

function rankedTeams(profile: PlayerRankedProfileContract | null): RankedTeam[] {
  const snapshot = profile?.snapshot
  if (!snapshot) return []

  const fixedTeams = [...snapshot.fixedTeams].sort((left, right) => right.rating - left.rating)
  const soloQueueTeams = snapshot.soloQueue.map((team) => ({
    ...team,
    brawlhallaIdOne: profile.brawlhallaId,
    brawlhallaIdTwo: 0 as const,
  }))
  return [...fixedTeams, ...soloQueueTeams]
}

export function PlayerProfileHierarchy({ player, refreshing, careerRefreshing }: PlayerProfileHierarchyProps) {
  const teams = rankedTeams(player.currentSeason)
  const mainLegend = player.currentSeason?.snapshot?.mainLegend
  const topLegend = mainLegend ? { legendNameKey: mainLegend.legendNameKey } : null

  return (
    <>
      <ProfileHeader player={player} topLegend={topLegend} aliases={displayAliases(player)} refreshing={refreshing} />
      <RankedCard currentSeason={player.currentSeason} />
      <ProfileSections
        identity={{ brawlhallaId: player.brawlhallaId, name: player.name }}
        currentSeason={player.currentSeason}
        career={player.career}
        rankedTeams={teams}
        careerRefreshing={careerRefreshing}
      />
    </>
  )
}
