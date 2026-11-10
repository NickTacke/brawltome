// Pure label allow-lists and text scrubbers shared by browser and server code. Keep this file free of imports.
export const analyticsRoutes = [
  '/',
  '/account',
  '/clan/[id]',
  '/guild/[id]',
  '/guilds',
  '/leaderboard',
  '/player/[id]',
  '/learn',
  '/matches',
  '/queue',
  '/stats',
  '/stats/career-weapon-usage',
  '/tournaments',
  '/privacy',
  '/terms',
  'other',
] as const

export const analyticsDevices = ['mobile', 'tablet', 'desktop'] as const

export const analyticsFeatures = [
  'leaderboard.mode',
  'leaderboard.region',
  'leaderboard.page_next',
  'leaderboard.page_depth_5plus',
  'clan.view',
  'queue.view',
  'pin',
  'unpin',
  'discord.link',
  'theme.change',
  'command_palette.open',
] as const

export const analyticsTrpcProcedure = [
  'account.current',
  'account.preferences',
  'account.updatePreferences',
  'account.primaryPlayer',
  'account.playerShortcuts',
  'account.pinnedPlayers',
  'account.pinPlayer',
  'account.unpinPlayer',
  'account.reorderPinnedPlayers',
  'status.discordReady',
  'player.referenceById',
  'player.rankedById',
  'player.careerById',
  'player.requestRefresh',
  'player.refresh',
  'clan.byId',
  'clan.membershipByPlayerId',
  'clan.refresh',
  'search.local',
  'leaderboard.get',
  'leaderboard.recentActivity',
  'statistics.legendMeta',
  'statistics.legendMetaHistory',
  'statistics.careerWeaponUsage',
  'statistics.careerWeaponUsageHistory',
  'other',
] as const
export const analyticsTrpcCode = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'TIMEOUT',
  'TOO_MANY_REQUESTS',
  'INTERNAL_SERVER_ERROR',
  'NETWORK',
  'OTHER',
] as const

// what visitors type and what errors say can name a person, so analytics text goes through these before it is logged
const stripSecrets = (text: string): string =>
  text
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/(api_key|token|secret|password|bearer)([\s:=]+\S+|\S*)/gi, '[redacted]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]')
    .replace(/(?<![\w:])(?=[0-9a-f:]*[0-9a-f])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi, '[ip]')
    .replace(/\b\d{5,}\b/g, '[id]')

export const scrubQuery = (text: string): string => stripSecrets(text).trim().replace(/\s+/g, ' ').slice(0, 64)

export const scrubError = (text: string): string =>
  stripSecrets(text.replace(/https?:\/\/\S+/gi, '[url]'))
    .replace(/\?\S*/g, '')
    .slice(0, 200)
