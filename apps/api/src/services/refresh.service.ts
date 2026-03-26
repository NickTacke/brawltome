import type { BhApiClient } from '@brawltome/bhapi'
import {
  clan,
  clanMember,
  player,
  playerAlias,
  playerClan,
  playerRankedLegend,
  playerRankedTeam,
  playerStatsLegend,
  playerWeaponStat,
  ratingHistory,
} from '@brawltome/database'
import type { Database } from '@brawltome/database'
import { desc, eq } from 'drizzle-orm'
import { aggregateWeapons } from './game-data.service'

interface RefreshDeps {
  db: Database
  bhapi: BhApiClient
}

// ---- REFRESH RANKED ----

export async function processRefreshRanked({ db, bhapi }: RefreshDeps, brawlhallaId: number) {
  const data = await bhapi.getPlayerRanked(brawlhallaId)
  if (!data) return

  await db.transaction(async (tx) => {
    const existing = await tx.query.player.findFirst({
      where: eq(player.brawlhallaId, brawlhallaId),
      columns: { name: true, tier: true, valhallanConfirmedAt: true },
    })

    // Track name change as alias (ranked API returns empty name for unranked players)
    if (existing && data.name && existing.name !== data.name) {
      await tx
        .insert(playerAlias)
        .values({
          brawlhallaId,
          key: existing.name.toLowerCase(),
          value: existing.name,
        })
        .onConflictDoNothing()
    }

    // Compute best legend from ranked legends
    const bestLegend = data.legends.reduce(
      (best, l) => (l.games > best.games ? { id: l.legend_id, games: l.games, wins: l.wins } : best),
      { id: 0, games: 0, wins: 0 },
    )

    // Keep Valhallan tier if confirmed within grace period (3 hours).
    // The ranked API doesn't know about Valhallan — only the rankings API does.
    // The janitor updates valhallanConfirmedAt when it sees the player on rankings.
    const VALHALLAN_GRACE_MS = 3 * 60 * 60 * 1000
    const isValhallanGraced =
      existing?.tier?.startsWith('Valhallan') &&
      existing.valhallanConfirmedAt &&
      Date.now() - existing.valhallanConfirmedAt.getTime() < VALHALLAN_GRACE_MS
    const tier = isValhallanGraced ? existing?.tier : data.tier

    // Update player ranked fields (skip name if ranked API returned empty)
    await tx
      .update(player)
      .set({
        ...(data.name ? { name: data.name } : {}),
        region: data.region,
        rating: data.rating,
        peakRating: data.peak_rating,
        tier,
        rankedGames: data.games,
        rankedWins: data.wins,
        bestLegend: bestLegend.id,
        bestLegendGames: bestLegend.games,
        bestLegendWins: bestLegend.wins,
        rankedLastUpdated: new Date(),
        lastUpdated: new Date(),
      })
      .where(eq(player.brawlhallaId, brawlhallaId))

    // Replace ranked legends
    await tx.delete(playerRankedLegend).where(eq(playerRankedLegend.brawlhallaId, brawlhallaId))
    if (data.legends.length > 0) {
      await tx.insert(playerRankedLegend).values(
        data.legends.map((l) => ({
          brawlhallaId,
          legendId: l.legend_id,
          legendNameKey: l.legend_name_key,
          rating: l.rating,
          peakRating: l.peak_rating,
          tier: l.tier,
          wins: l.wins,
          games: l.games,
        })),
      )
    }

    // Replace ranked teams (preserve Valhallan grace period)
    const existingTeams = await tx.query.playerRankedTeam.findMany({
      where: eq(playerRankedTeam.brawlhallaId, brawlhallaId),
      columns: { brawlhallaIdOne: true, brawlhallaIdTwo: true, tier: true, valhallanConfirmedAt: true },
    })
    const teamGraceMap = new Map(
      existingTeams
        .filter(
          (t) =>
            t.tier?.startsWith('Valhallan') &&
            t.valhallanConfirmedAt &&
            Date.now() - t.valhallanConfirmedAt.getTime() < VALHALLAN_GRACE_MS,
        )
        .map((t) => [`${t.brawlhallaIdOne}:${t.brawlhallaIdTwo}`, t]),
    )

    await tx.delete(playerRankedTeam).where(eq(playerRankedTeam.brawlhallaId, brawlhallaId))
    if (data['2v2'].length > 0) {
      // Deduplicate teams by PK (brawlhallaId, brawlhallaIdOne, brawlhallaIdTwo)
      const seen = new Set<string>()
      const teams = data['2v2'].filter((t) => {
        const key = `${t.brawlhalla_id_one}:${t.brawlhalla_id_two}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      await tx.insert(playerRankedTeam).values(
        teams.map((t) => {
          const graced = teamGraceMap.get(`${t.brawlhalla_id_one}:${t.brawlhalla_id_two}`)
          return {
            brawlhallaId,
            brawlhallaIdOne: t.brawlhalla_id_one,
            brawlhallaIdTwo: t.brawlhalla_id_two,
            teamName: t.teamname,
            rating: t.rating,
            peakRating: t.peak_rating,
            tier: graced ? graced.tier : t.tier,
            wins: t.wins,
            games: t.games,
            region: String(t.region),
            globalRank: t.global_rank,
            valhallanConfirmedAt: graced?.valhallanConfirmedAt ?? null,
          }
        }),
      )
    }

    // Snapshot rating history (only if changed)
    const lastSnapshot = await tx.query.ratingHistory.findFirst({
      where: eq(ratingHistory.brawlhallaId, brawlhallaId),
      orderBy: [desc(ratingHistory.recordedAt)],
    })

    if (
      data.rating > 0 &&
      (!lastSnapshot || lastSnapshot.rating !== data.rating || lastSnapshot.games !== data.games)
    ) {
      await tx.insert(ratingHistory).values({
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

// ---- REFRESH STATS ----

export async function processRefreshStats({ db, bhapi }: RefreshDeps, brawlhallaId: number) {
  const data = await bhapi.getPlayerStats(brawlhallaId)
  if (!data) return

  const parseDmg = (s: string): bigint => BigInt(s || '0')

  const filteredLegends = data.legends.filter((l) => l.legend_id !== 0)
  const matchTimeTotal = filteredLegends.reduce((sum, l) => sum + l.matchtime, 0)

  await db.transaction(async (tx) => {
    // Update player stats fields
    await tx
      .update(player)
      .set({
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
        statsLastUpdated: new Date(),
        lastUpdated: new Date(),
      })
      .where(eq(player.brawlhallaId, brawlhallaId))

    // Replace stats legends
    await tx.delete(playerStatsLegend).where(eq(playerStatsLegend.brawlhallaId, brawlhallaId))
    if (filteredLegends.length > 0) {
      await tx.insert(playerStatsLegend).values(
        filteredLegends.map((l) => ({
          brawlhallaId,
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
    }

    // Replace weapon stats (aggregated across legends)
    await tx.delete(playerWeaponStat).where(eq(playerWeaponStat.brawlhallaId, brawlhallaId))
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
    if (weapons.length > 0) {
      await tx.insert(playerWeaponStat).values(
        weapons.map((w) => ({
          brawlhallaId,
          weapon: w.weapon,
          timeHeld: w.timeHeld,
          damage: w.damage,
          kos: w.kos,
        })),
      )
    }

    // Handle clan
    if (data.clan) {
      await tx
        .insert(playerClan)
        .values({
          brawlhallaId,
          clanName: data.clan.clan_name,
          clanId: data.clan.clan_id,
          clanXp: parseDmg(data.clan.clan_xp),
          clanLifetimeXp: BigInt(data.clan.clan_lifetime_xp),
          personalXp: data.clan.personal_xp,
        })
        .onConflictDoUpdate({
          target: playerClan.brawlhallaId,
          set: {
            clanName: data.clan.clan_name,
            clanId: data.clan.clan_id,
            clanXp: parseDmg(data.clan.clan_xp),
            clanLifetimeXp: BigInt(data.clan.clan_lifetime_xp),
            personalXp: data.clan.personal_xp,
          },
        })
    } else {
      await tx.delete(playerClan).where(eq(playerClan.brawlhallaId, brawlhallaId))
    }
  })
}

// ---- REFRESH CLAN ----

export async function processRefreshClan({ db, bhapi }: RefreshDeps, clanId: number) {
  const data = await bhapi.getClan(clanId)
  if (!data) return

  await db.transaction(async (tx) => {
    await tx
      .insert(clan)
      .values({
        clanId: data.clan_id,
        clanName: data.clan_name,
        clanCreateDate: new Date(data.clan_create_date * 1000),
        clanXp: BigInt(data.clan_xp || '0'),
        clanLifetimeXp: BigInt(data.clan_lifetime_xp),
        lastUpdated: new Date(),
      })
      .onConflictDoUpdate({
        target: clan.clanId,
        set: {
          clanName: data.clan_name,
          clanXp: BigInt(data.clan_xp || '0'),
          clanLifetimeXp: BigInt(data.clan_lifetime_xp),
          lastUpdated: new Date(),
        },
      })

    // Replace members
    await tx.delete(clanMember).where(eq(clanMember.clanId, data.clan_id))
    if (data.clan.length > 0) {
      await tx.insert(clanMember).values(
        data.clan.map((m) => ({
          clanId: data.clan_id,
          brawlhallaId: m.brawlhalla_id,
          name: m.name,
          rank: m.rank,
          joinDate: new Date(m.join_date * 1000),
          xp: m.xp,
        })),
      )
    }
  })
}
