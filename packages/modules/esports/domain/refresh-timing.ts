const dayMs = 24 * 60 * 60 * 1000

// how long stored esports data counts as fresh: a linked player's results change with every event they play, while
// a player brawltools does not know rarely becomes known
export const linkedTtlMs = 7 * dayMs
export const noneTtlMs = 30 * dayMs

// how long the read waits after a failed refresh before it asks for another
export const failureBackoffMs = dayMs
