// order matters: leaderboards, crawls and statistics walk and sort regions in this order
export const rankedRegions = ['US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'] as const
export type RankedRegion = (typeof rankedRegions)[number]

export const rankedModes = ['1v1', '2v2', 'solo2v2', '3v3'] as const
export type RankedMode = (typeof rankedModes)[number]
