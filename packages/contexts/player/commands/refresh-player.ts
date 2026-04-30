import type { BhApiClient } from '@brawltome/bhapi'
import type { Database } from '@brawltome/database'
import { aggregateWeapons } from '@brawltome/shared'
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
  const data = await bhapi.getPlayerStats(brawlhallaId, { caller })
  if (!data) return

  const parseDmg = (s: string): bigint => BigInt(s || '0')

  const filteredLegends = data.legends.filter((l) => l.legend_id !== 0)
  const matchTimeTotal = filteredLegends.reduce((sum, l) => sum + l.matchtime, 0)

  const repo = createPlayerRepo(db)
  await repo.transaction(async (tx) => {
    const txRepo = createPlayerRepo(tx as unknown as Database)

    await txRepo.updateStats(brawlhallaId, {
      name: data.name,
      xp: data.xp,
      level: data.level,
      xpPercentage: data.xp_percentage,
      totalGames: data.games,
      totalWins: data.wins,
      matchTimeTotal,
      damageBomb: parseDmg(data.damagebomb),
      damageMine: parseDmg(data.damagemine),
      damageSpikeball: parseDmg(data.damagespikeball),
      damageSidekick: parseDmg(data.damagesidekick),
      hitSnowball: data.hitsnowball,
      koBomb: data.kobomb,
      koMine: data.komine,
      koSpikeball: data.kospikeball,
      koSidekick: data.kosidekick,
      koSnowball: data.kosnowball,
    })

    await txRepo.replaceStatsLegends(
      brawlhallaId,
      filteredLegends.map((l) => ({
        legendId: l.legend_id,
        legendNameKey: l.legend_name_key,
        xp: l.xp,
        level: l.level,
        xpPercentage: l.xp_percentage,
        games: l.games,
        wins: l.wins,
        matchTime: l.matchtime,
        kos: l.kos,
        teamKos: l.teamkos,
        suicides: l.suicides,
        falls: l.falls,
        damageDealt: parseDmg(l.damagedealt),
        damageTaken: parseDmg(l.damagetaken),
        damageWeaponOne: parseDmg(l.damageweaponone),
        damageWeaponTwo: parseDmg(l.damageweapontwo),
        timeHeldWeaponOne: l.timeheldweaponone,
        timeHeldWeaponTwo: l.timeheldweapontwo,
        koWeaponOne: l.koweaponone,
        koWeaponTwo: l.koweapontwo,
        koUnarmed: l.kounarmed,
        koThrownItem: l.kothrownitem,
        koGadgets: l.kogadgets,
        damageUnarmed: parseDmg(l.damageunarmed),
        damageThrownItem: parseDmg(l.damagethrownitem),
        damageGadgets: parseDmg(l.damagegadgets),
      })),
    )

    const weapons = aggregateWeapons(
      filteredLegends.map((l) => ({
        legendId: l.legend_id,
        damageWeaponOne: parseDmg(l.damageweaponone),
        damageWeaponTwo: parseDmg(l.damageweapontwo),
        timeHeldWeaponOne: l.timeheldweaponone,
        timeHeldWeaponTwo: l.timeheldweapontwo,
        koWeaponOne: l.koweaponone,
        koWeaponTwo: l.koweapontwo,
      })),
    )

    await txRepo.replaceWeaponStats(brawlhallaId, weapons)
    await txRepo.upsertClan(brawlhallaId, data.clan ?? null)
  })
}
