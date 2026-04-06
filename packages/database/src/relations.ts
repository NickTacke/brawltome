import { relations } from 'drizzle-orm'
import {
  clan,
  clanMember,
  oauthAccount,
  player,
  playerAlias,
  playerClan,
  playerRankedLegend,
  playerRankedTeam,
  playerStatsLegend,
  playerWeaponStat,
  ratingHistory,
  playerLink,
  session,
  user,
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

export const ratingHistoryRelations = relations(ratingHistory, ({ one }) => ({
  player: one(player, {
    fields: [ratingHistory.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}))

export const userRelations = relations(user, ({ one, many }) => ({
  oauthAccounts: many(oauthAccount),
  sessions: many(session),
  playerLink: one(playerLink, {
    fields: [user.id],
    references: [playerLink.userId],
  }),
}))

export const oauthAccountRelations = relations(oauthAccount, ({ one }) => ({
  user: one(user, {
    fields: [oauthAccount.userId],
    references: [user.id],
  }),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const playerLinkRelations = relations(playerLink, ({ one }) => ({
  user: one(user, {
    fields: [playerLink.userId],
    references: [user.id],
  }),
}))
