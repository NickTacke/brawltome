import type { Database } from '@brawltome/database'
import { oauthAccount, user } from '@brawltome/database'
import { and, eq } from 'drizzle-orm'
import type { OAuthAccount, User, UserWithPrimaryAccount } from './user'

export interface UserRepo {
  findByDiscordId(discordId: string): Promise<UserWithPrimaryAccount | null>
  findById(userId: string): Promise<UserWithPrimaryAccount | null>
  upsertDiscordUser(profile: {
    discordId: string
    username: string
    avatarHash: string | null
  }): Promise<UserWithPrimaryAccount>
}

export function createUserRepo(db: Database): UserRepo {
  return {
    async findByDiscordId(discordId) {
      const row = await db.query.oauthAccount.findFirst({
        where: and(eq(oauthAccount.provider, 'discord'), eq(oauthAccount.providerAccountId, discordId)),
        with: { user: true },
      })
      if (!row) return null
      return attachPrimary(row.user, row)
    },

    async findById(userId) {
      const u = await db.query.user.findFirst({
        where: eq(user.id, userId),
        with: { oauthAccounts: true },
      })
      if (!u) return null
      const primary = u.oauthAccounts.find((a) => a.provider === 'discord') ?? u.oauthAccounts[0]
      if (!primary) return null
      return attachPrimary(u, primary)
    },

    async upsertDiscordUser(profile) {
      return db.transaction(async (tx) => {
        const existing = await tx.query.oauthAccount.findFirst({
          where: and(
            eq(oauthAccount.provider, 'discord'),
            eq(oauthAccount.providerAccountId, profile.discordId),
          ),
          with: { user: true },
        })

        if (existing) {
          const [updated] = await tx
            .update(oauthAccount)
            .set({
              username: profile.username,
              avatarHash: profile.avatarHash,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(oauthAccount.provider, 'discord'),
                eq(oauthAccount.providerAccountId, profile.discordId),
              ),
            )
            .returning()
          return attachPrimary(existing.user, updated)
        }

        const [newUser] = await tx.insert(user).values({}).returning()
        const [newAccount] = await tx
          .insert(oauthAccount)
          .values({
            userId: newUser.id,
            provider: 'discord',
            providerAccountId: profile.discordId,
            username: profile.username,
            avatarHash: profile.avatarHash,
          })
          .returning()
        return attachPrimary(newUser, newAccount)
      })
    },
  }
}

function attachPrimary(
  u: { id: string; createdAt: Date; updatedAt: Date },
  a: {
    userId: string
    provider: string
    providerAccountId: string
    username: string
    avatarHash: string | null
    refreshToken: string | null
    createdAt: Date
    updatedAt: Date
  },
): UserWithPrimaryAccount {
  return {
    id: u.id,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    primaryAccount: {
      userId: a.userId,
      provider: 'discord',
      providerAccountId: a.providerAccountId,
      username: a.username,
      avatarHash: a.avatarHash,
      refreshToken: a.refreshToken,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    },
  }
}
