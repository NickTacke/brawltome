// Brawlhalla's internal tick rate. Replay timestamps are in ms but the game
// itself runs at 60 fixed-step ticks per second. The simulator operates in
// tick space; helpers convert to/from ms.
export const TICK_HZ = 60
export const TICK_MS = 1000 / TICK_HZ

export const tickToMs = (tick: number): number => tick * TICK_MS
export const msToTick = (ms: number): number => Math.round(ms / TICK_MS)
