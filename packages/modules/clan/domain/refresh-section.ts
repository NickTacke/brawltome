export const clanRefreshSections = ['profile', 'roster'] as const

export type ClanRefreshSection = (typeof clanRefreshSections)[number]
