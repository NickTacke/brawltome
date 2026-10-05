// Pure label allow-lists shared by browser and server code. Keep this file free of imports.
export const analyticsRoutes = [
  '/',
  '/account',
  '/clan/[id]',
  '/player/[id]',
  '/learn',
  '/matches',
  '/queue',
  '/stats',
  '/stats/career-weapon-usage',
  '/tournaments',
  '/privacy',
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
