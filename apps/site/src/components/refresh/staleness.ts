import type { ClanProfileContract } from '@brawltome/contracts'
import type { PlayerData } from '../../server/load-player'

// the api refreshes a guild after an hour, see CLAN_TTL_MS in apps/api
const guildFreshForMs = 60 * 60 * 1_000

function isNewer(after: string | null | undefined, before: string | null | undefined): boolean {
  if (!after) return false

  return !before || Date.parse(after) > Date.parse(before)
}

/** The api works out freshness when it reads a player, so a section is stale unless it said fresh. */
export function isPlayerStale(player: PlayerData): boolean {
  return player.currentSeason?.freshness !== 'fresh' || player.career?.freshness !== 'fresh'
}

/** Whether every section that was stale in the baseline has a newer success now. */
export function isPlayerRefreshed(baseline: PlayerData, current: PlayerData): boolean {
  const before = { ranked: baseline.currentSeason, career: baseline.career }
  const after = { ranked: current.currentSeason, career: current.career }

  const isRankedDone =
    before.ranked?.freshness === 'fresh' || isNewer(after.ranked?.lastSuccessAt, before.ranked?.lastSuccessAt)

  const isCareerDone =
    before.career?.freshness === 'fresh' || isNewer(after.career?.lastSuccessAt, before.career?.lastSuccessAt)

  return isRankedDone && isCareerDone
}

function isOld(lastSuccessAt: string | null | undefined, now: Date): boolean {
  if (!lastSuccessAt) return true

  return now.getTime() - Date.parse(lastSuccessAt) > guildFreshForMs
}

export function isGuildStale(clan: ClanProfileContract, now: Date): boolean {
  return isOld(clan.profile.lastSuccessAt, now) || isOld(clan.roster?.lastSuccessAt, now)
}

/** Whether every section that was stale in the baseline has a newer success now. */
export function isGuildRefreshed(baseline: ClanProfileContract, current: ClanProfileContract, loadedAt: Date): boolean {
  const isProfileDone =
    !isOld(baseline.profile.lastSuccessAt, loadedAt) ||
    isNewer(current.profile.lastSuccessAt, baseline.profile.lastSuccessAt)

  const isRosterDone =
    !isOld(baseline.roster?.lastSuccessAt, loadedAt) ||
    isNewer(current.roster?.lastSuccessAt, baseline.roster?.lastSuccessAt)

  return isProfileDone && isRosterDone
}
