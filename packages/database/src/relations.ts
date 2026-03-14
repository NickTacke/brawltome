import { relations } from 'drizzle-orm'
import {
  clan,
  clanMember,
  discordLink,
  player,
  playerAlias,
  playerClan,
  playerRankedLegend,
  playerRankedTeam,
  playerStatsLegend,
  playerWeaponStat,
  ratingHistory,
} from './schema'

export const playerRelations = relations(player, ({ one, many }) => ({
  aliases: many(playerAlias),
  statsLegends: many(playerStatsLegend),
  weaponStats: many(playerWeaponStat),
  clan: one(playerClan, {
    fields: [player.brawlhallaId],
    references: [playerClan.brawlhallaId],
  }),
  rankedLegends: many(playerRankedLegend),
  rankedTeams: many(playerRankedTeam),
  discordLink: one(discordLink, {
    fields: [player.brawlhallaId],
    references: [discordLink.brawlhallaId],
  }),
  ratingHistory: many(ratingHistory),
}))

export const playerAliasRelations = relations(playerAlias, ({ one }) => ({
  player: one(player, {
    fields: [playerAlias.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}))

export const playerStatsLegendRelations = relations(playerStatsLegend, ({ one }) => ({
  player: one(player, {
    fields: [playerStatsLegend.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}))

export const playerClanRelations = relations(playerClan, ({ one }) => ({
  player: one(player, {
    fields: [playerClan.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}))

export const playerWeaponStatRelations = relations(playerWeaponStat, ({ one }) => ({
  player: one(player, {
    fields: [playerWeaponStat.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}))

export const playerRankedLegendRelations = relations(playerRankedLegend, ({ one }) => ({
  player: one(player, {
    fields: [playerRankedLegend.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}))

export const playerRankedTeamRelations = relations(playerRankedTeam, ({ one }) => ({
  player: one(player, {
    fields: [playerRankedTeam.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}))

export const clanRelations = relations(clan, ({ many }) => ({
  members: many(clanMember),
}))

export const clanMemberRelations = relations(clanMember, ({ one }) => ({
  clan: one(clan, {
    fields: [clanMember.clanId],
    references: [clan.clanId],
  }),
}))

export const discordLinkRelations = relations(discordLink, ({ one }) => ({
  player: one(player, {
    fields: [discordLink.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}))

export const ratingHistoryRelations = relations(ratingHistory, ({ one }) => ({
  player: one(player, {
    fields: [ratingHistory.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}))
