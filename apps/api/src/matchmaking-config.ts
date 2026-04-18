export interface MatchmakingConfig {
  enabled: boolean
  r2: {
    accessKeyId: string
    secretAccessKey: string
    endpoint: string
    bucket: string
  }
}

export function readMatchmakingConfig(env: NodeJS.ProcessEnv = process.env): MatchmakingConfig {
  return {
    enabled: env.MATCHMAKING_ENABLED === 'true',
    r2: {
      accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
      endpoint: env.R2_ENDPOINT ?? '',
      bucket: env.R2_BUCKET ?? '',
    },
  }
}
