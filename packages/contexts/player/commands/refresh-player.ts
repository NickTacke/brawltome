import type { BhApiClient, BhV1PlayerStatsAll } from '@brawltome/bhapi'
import type { Database } from '@brawltome/database'
import { aggregateWeapons, getLegendById } from '@brawltome/shared'
import { computeBestLegend, isValhallanGraced, shouldSnapshotRating } from '../player'
import { createPlayerRepo } from '../player.repo'

const REGION_BY_ID: Record<number, string> = {
  2: 'US-E',
  3: 'EU',
  4: 'SEA',
  5: 'BRZ',
  6: 'AUS',
  7: 'US-W',
  8: 'JPN',
  9: 'ME',
  10: 'SA',
}

interface RefreshDeps {
  db: Database
  bhapi: BhApiClient
}

export async function processRefreshRanked(
  { db, bhapi }: RefreshDeps,
  brawlhallaId: number,
  caller: 'on-demand' | 'background' = 'background',
) {
  const data = await bhapi.getPlayerRanked(brawlhallaId, { caller })
  if (!data) return

  const repo = createPlayerRepo(db)
  await repo.transaction(async (tx) => {
    const txRepo = createPlayerRepo(tx as unknown as Database)

    const existing = await txRepo.getExistingPlayerMeta(brawlhallaId)

    if (existing && data.name && existing.name !== data.name) {
      await txRepo.upsertAlias(brawlhallaId, existing.name)
    }

    const bestLegend = computeBestLegend(data.legends)
    const graced = isValhallanGraced(existing?.tier ?? null, existing?.valhallanConfirmedAt ?? null)
    const tier = graced ? existing?.tier : data.tier

    await txRepo.updateRanked(brawlhallaId, {
      name: data.name || undefined,
      region: data.region,
      rating: data.rating,
      peakRating: data.peak_rating,
      tier: tier ?? null,
      rankedGames: data.games,
      rankedWins: data.wins,
      bestLegend: bestLegend.id,
      bestLegendGames: bestLegend.games,
      bestLegendWins: bestLegend.wins,
    })

    await txRepo.replaceRankedLegends(brawlhallaId, data.legends)

    const existingTeams = await txRepo.getExistingRankedTeams(brawlhallaId)
    const teamGraceMap = new Map(
      existingTeams
        .filter((t) => isValhallanGraced(t.tier ?? null, t.valhallanConfirmedAt ?? null))
        .map((t) => [`${t.brawlhallaIdOne}:${t.brawlhallaIdTwo}`, t]),
    )

    const seen = new Set<string>()
    const teams = data['2v2'].filter((t) => {
      const key = `${t.brawlhalla_id_one}:${t.brawlhalla_id_two}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    await txRepo.replaceRankedTeams(
      brawlhallaId,
      teams.map((t) => {
        const gracedTeam = teamGraceMap.get(`${t.brawlhalla_id_one}:${t.brawlhalla_id_two}`)
        return {
          brawlhallaIdOne: t.brawlhalla_id_one,
          brawlhallaIdTwo: t.brawlhalla_id_two,
          teamName: t.teamname,
          rating: t.rating,
          peakRating: t.peak_rating,
          tier: gracedTeam ? (gracedTeam.tier ?? t.tier) : t.tier,
          wins: t.wins,
          games: t.games,
          region: REGION_BY_ID[t.region] ?? String(t.region),
          valhallanConfirmedAt: gracedTeam?.valhallanConfirmedAt ?? null,
        }
      }),
    )

    const lastSnapshot = await txRepo.getLastRatingSnapshot(brawlhallaId)

    if (
      shouldSnapshotRating(
        data.rating,
        lastSnapshot ? { rating: lastSnapshot.rating, games: lastSnapshot.games } : null,
        data.games,
      )
    ) {
      await txRepo.insertRatingSnapshot({
        brawlhallaId,
        rating: data.rating,
        peakRating: data.peak_rating,
        tier: data.tier,
        games: data.games,
        wins: data.wins,
      })
    }
  })
}

export async function processRefreshStats(
  { db, bhapi }: RefreshDeps,
  brawlhallaId: number,
  caller: 'on-demand' | 'background' = 'background',
) {
  const data = (await bhapi.getPlayerStatsV1(brawlhallaId, 'all', { caller })) as BhV1PlayerStatsAll | null
  if (!data) return

  const toBig = (n: number | undefined): bigint => BigInt(Math.trunc(n ?? 0))

  const filteredLegends = data.legends.filter((l) => l.legend_id !== 0)
  const matchTimeTotal = filteredLegends.reduce((s, l) => s + (l.match_time ?? 0), 0)

  // Fetch guild before the transaction — no network calls inside DB transactions
  const playerGuild = await bhapi.getPlayerGuildV1(brawlhallaId, { caller })
  let clanData: {
    clan_name: string
    clan_id: number
    clan_xp: number
    clan_lifetime_xp: number
    personal_xp: number
  } | null = null
  let updateClan: 'set' | 'clear' | 'skip'

  if (playerGuild?.guild) {
    const guildStats = await bhapi.getGuildStatsV1(playerGuild.guild.guild_id, { caller })
    if (guildStats) {
      clanData = {
        clan_name: guildStats.name,
        clan_id: playerGuild.guild.guild_id,
        clan_xp: guildStats.xp,
        clan_lifetime_xp: guildStats.legacy_xp + guildStats.xp,
        personal_xp: playerGuild.guild.personal_xp,
      }
      updateClan = 'set'
    } else {
      // Guild uncached/404 — preserve existing clan row
      updateClan = 'skip'
    }
  } else {
    // Player has no guild — clear
    updateClan = 'clear'
  }

  const repo = createPlayerRepo(db)
  await repo.transaction(async (tx) => {
    const txRepo = createPlayerRepo(tx as unknown as Database)

    await txRepo.updateStats(brawlhallaId, {
      name: data.name,
      xp: data.xp ?? 0,
      level: data.level ?? 0,
      xpPercentage: data.xp_percentage ?? 0,
      totalGames: data.games,
      totalWins: data.wins,
      matchTimeTotal,
      damageBomb: toBig(data.damage_bomb),
      damageMine: toBig(data.damage_mine),
      damageSpikeball: toBig(data.damage_spikeball),
      damageSidekick: toBig(data.damage_sidekick),
      hitSnowball: data.hit_snowball ?? 0,
      koBomb: data.ko_bomb ?? 0,
      koMine: data.ko_mine ?? 0,
      koSpikeball: data.ko_spikeball ?? 0,
      koSidekick: data.ko_sidekick ?? 0,
      koSnowball: data.ko_snowball ?? 0,
    })

    await txRepo.replaceStatsLegends(
      brawlhallaId,
      filteredLegends.map((l) => ({
        legendId: l.legend_id,
        legendNameKey: getLegendById(l.legend_id)?.legendNameKey ?? '',
        xp: l.xp ?? 0,
        level: l.level ?? 0,
        xpPercentage: l.xp_percentage ?? 0,
        games: l.games ?? 0,
        wins: l.wins ?? 0,
        matchTime: l.match_time ?? 0,
        kos: l.kos ?? 0,
        teamKos: l.team_kos ?? 0,
        suicides: l.suicides ?? 0,
        falls: l.falls ?? 0,
        damageDealt: toBig(l.damage_dealt),
        damageTaken: toBig(l.damage_taken),
        damageWeaponOne: toBig(l.damage_weapon_one),
        damageWeaponTwo: toBig(l.damage_weapon_two),
        timeHeldWeaponOne: l.time_held_weapon_one ?? 0,
        timeHeldWeaponTwo: l.time_held_weapon_two ?? 0,
        koWeaponOne: l.ko_weapon_one ?? 0,
        koWeaponTwo: l.ko_weapon_two ?? 0,
        koUnarmed: l.ko_unarmed ?? 0,
        koThrownItem: l.ko_thrown_item ?? 0,
        koGadgets: l.ko_gadgets ?? 0,
        damageUnarmed: toBig(l.damage_unarmed),
        damageThrownItem: toBig(l.damage_thrown_item),
        damageGadgets: toBig(l.damage_gadgets),
      })),
    )

    const weapons = aggregateWeapons(
      filteredLegends.map((l) => ({
        legendId: l.legend_id,
        damageWeaponOne: toBig(l.damage_weapon_one),
        damageWeaponTwo: toBig(l.damage_weapon_two),
        timeHeldWeaponOne: l.time_held_weapon_one ?? 0,
        timeHeldWeaponTwo: l.time_held_weapon_two ?? 0,
        koWeaponOne: l.ko_weapon_one ?? 0,
        koWeaponTwo: l.ko_weapon_two ?? 0,
      })),
    )

    await txRepo.replaceWeaponStats(brawlhallaId, weapons)

    if (updateClan === 'set') {
      await txRepo.upsertClan(brawlhallaId, clanData)
    } else if (updateClan === 'clear') {
      await txRepo.upsertClan(brawlhallaId, null)
    }
    // 'skip' -> do nothing
  })
}
