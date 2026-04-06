export interface User {
  id: string
  createdAt: Date
  updatedAt: Date
}

export interface OAuthAccount {
  userId: string
  provider: 'discord'
  providerAccountId: string
  username: string
  avatarHash: string | null
  refreshToken: string | null
  createdAt: Date
  updatedAt: Date
}

export interface UserWithPrimaryAccount extends User {
  primaryAccount: OAuthAccount
}
