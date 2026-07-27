import type { BhApiClient, BhV1PlayerStatsAll, BhV1PlayerStatsRanked } from '@brawltome/bhapi'
import type { Database } from '@brawltome/database'
import { aggregateWeapons, getLegendById, initGameData } from '@brawltome/shared'
import { computeBestLegend, isValhallanGraced, shouldSnapshotRating } from '../player'
import { createPlayerRepo } from '../player.repo'

// v1 emits region "JPS"; the app's internal convention is "JPN"
const normRegion = (r: string): string => (r === 'JPS' ? 'JPN' : r)

interface RefreshDeps {
  db: Database
  bhapi: BhApiClient
}

export async function processRefreshRanked(
  { db, bhapi }: RefreshDeps,
  brawlhallaId: number,
  caller: 'on-demand' | 'background' = 'background',
) {
  const ranked = (await bhapi.getPlayerStatsV1(brawlhallaId, 'ranked_1v1', { caller })) as BhV1PlayerStatsRanked | null
  const teamsResp = await bhapi.getPlayerTeamsV1(brawlhallaId, { caller })

  if (!ranked) {
    const lifetimeStats = await bhapi.getPlayerStatsV1(brawlhallaId, 'all', { caller })
    if (!lifetimeStats) {
      throw new Error(`Ranked absence could not be corroborated for player ${brawlhallaId}`)
    }
  }

  if (ranked?.legends.some((l) => !getLegendById(l.legend_id))) {
    // A legend ID is missing from the cache (e.g. a newly released legend). Refresh
    // game data (upserts new legends from v1) so we resolve real keys instead of ''.
    await initGameData(db, bhapi)
  }

  const repo = createPlayerRepo(db)
  await repo.transaction(async (tx) => {
    const txRepo = createPlayerRepo(tx as unknown as Database)

    if (ranked) {
      const existing = await txRepo.getExistingPlayerMeta(brawlhallaId)

      if (existing && ranked.name && existing.name !== ranked.name) {
        await txRepo.upsertAlias(brawlhallaId, existing.name)
      }

      const bestLegend = computeBestLegend(ranked.legends)
      const graced = isValhallanGraced(existing?.tier ?? null, existing?.valhallanConfirmedAt ?? null)
      const tier = graced ? existing?.tier : ranked.tier

      await txRepo.updateRanked(brawlhallaId, {
        name: ranked.name || undefined,
        region: normRegion(ranked.region),
        rating: ranked.rating,
        peakRating: ranked.peak_rating,
        tier: tier ?? null,
        rankedGames: ranked.games,
        rankedWins: ranked.wins,
        bestLegend: bestLegend.id,
        bestLegendGames: bestLegend.games,
        bestLegendWins: bestLegend.wins,
      })

      const existingRankedKeys = new Map(
        (await txRepo.getExistingRankedLegends(brawlhallaId)).map((r) => [r.legendId, r.legendNameKey]),
      )

      await txRepo.replaceRankedLegends(
        brawlhallaId,
        ranked.legends
          .map((l) => ({
            legend_id: l.legend_id,
            legend_name_key: getLegendById(l.legend_id)?.legendNameKey ?? existingRankedKeys.get(l.legend_id) ?? '',
            rating: l.rating,
            peak_rating: l.peak_rating,
            tier: l.tier,
            wins: l.wins,
            games: l.games,
          }))
          .filter((entry) => entry.legend_name_key !== ''),
      )

      const lastSnapshot = await txRepo.getLastRatingSnapshot(brawlhallaId)
      if (
        shouldSnapshotRating(
          ranked.rating,
          lastSnapshot ? { rating: lastSnapshot.rating, games: lastSnapshot.games } : null,
          ranked.games,
        )
      ) {
        await txRepo.insertRatingSnapshot({
          brawlhallaId,
          rating: ranked.rating,
          peakRating: ranked.peak_rating,
          tier: ranked.tier,
          games: ranked.games,
          wins: ranked.wins,
        })
      }
    } else {
      // Lifetime stats corroborated the player above, so ranked 404 means unranked this season.
      await txRepo.clearRanked(brawlhallaId)
      await txRepo.replaceRankedLegends(brawlhallaId, [])
    }

    if (teamsResp) {
      const existingTeams = await txRepo.getExistingRankedTeams(brawlhallaId)
      const teamGraceMap = new Map(
        existingTeams
          .filter((t) => isValhallanGraced(t.tier ?? null, t.valhallanConfirmedAt ?? null))
          .map((t) => [`${t.brawlhallaIdOne}:${t.brawlhallaIdTwo}`, t]),
      )

      const seen = new Set<string>()
      const teams = (teamsResp.teams?.ranked_2v2 ?? []).filter((t) => {
        const key = `${t.brawlhalla_id_one}:${t.brawlhalla_id_two}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      await txRepo.replaceRankedTeams(
        brawlhallaId,
        teams.map((t) => {
          const g = teamGraceMap.get(`${t.brawlhalla_id_one}:${t.brawlhalla_id_two}`)
          return {
            brawlhallaIdOne: t.brawlhalla_id_one,
            brawlhallaIdTwo: t.brawlhalla_id_two,
            teamName: `${t.username_one} + ${t.username_two}`,
            rating: t.rating,
            peakRating: t.peak_rating,
            tier: g ? (g.tier ?? t.tier) : t.tier,
            wins: t.wins,
            games: t.games,
            region: normRegion(t.region),
            valhallanConfirmedAt: g?.valhallanConfirmedAt ?? null,
          }
        }),
      )
    }
  })
}

export async function processRefreshStats(
  { db, bhapi }: RefreshDeps,
  brawlhallaId: number,
  caller: 'on-demand' | 'background' = 'background',
) {
  const data = (await bhapi.getPlayerStatsV1(brawlhallaId, 'all', { caller })) as BhV1PlayerStatsAll | null
  if (!data) throw new Error(`Brawlhalla lifetime stats unavailable for player ${brawlhallaId}`)

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
    }
  }

  if (filteredLegends.some((l) => !getLegendById(l.legend_id))) {
    // A legend ID is missing from the cache (e.g. a newly released legend). Refresh
    // game data (upserts new legends from v1) so we resolve real keys instead of ''.
    await initGameData(db, bhapi)
  }

  const repo = createPlayerRepo(db)
  await repo.transaction(async (tx) => {
    const txRepo = createPlayerRepo(tx as unknown as Database)

    await txRepo.updateStats(brawlhallaId, {
      name: data.name,
      ...(data.xp !== undefined ? { xp: data.xp } : {}),
      ...(data.level !== undefined ? { level: data.level } : {}),
      ...(data.xp_percentage !== undefined ? { xpPercentage: data.xp_percentage } : {}),
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

    const existingStatsLegends = new Map(
      (await txRepo.getExistingStatsLegends(brawlhallaId)).map((legend) => [legend.legendId, legend]),
    )

    await txRepo.replaceStatsLegends(
      brawlhallaId,
      filteredLegends
        .map((l) => {
          const existing = existingStatsLegends.get(l.legend_id)
          return {
            legendId: l.legend_id,
            legendNameKey: getLegendById(l.legend_id)?.legendNameKey ?? existing?.legendNameKey ?? '',
            xp: l.xp ?? existing?.xp ?? 0,
            level: l.level ?? existing?.level ?? 0,
            xpPercentage: l.xp_percentage ?? existing?.xpPercentage ?? 0,
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
          }
        })
        .filter((entry) => entry.legendNameKey !== ''),
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

    if (clanData) await txRepo.upsertClan(brawlhallaId, clanData)
  })
}
