export interface Session {
  id: string
  userId: string
  expiresAt: Date
  createdAt: Date
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
export const SESSION_EXTEND_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
