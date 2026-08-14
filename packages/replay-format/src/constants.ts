// Replay timecodes advance in exact 16 ms slots. This is distinct from the
// renderer's nominal frame rate and preserves every serialized input change.
export const REPLAY_TIME_QUANTUM_MS = 16

// Pre-match countdown duration baked into replay timestamps.
export const INTRO_OFFSET_MS = 6016

export const STATE_INPUTS = 1
export const STATE_END = 2
export const STATE_HEADER = 3
export const STATE_GAME_DATA = 4
export const STATE_KO_FACES = 5
export const STATE_RESULTS = 6
export const STATE_FACES = 7
export const STATE_INVALID = 8

export const KNOWN_STATES = new Set<number>([
  STATE_INPUTS,
  STATE_END,
  STATE_HEADER,
  STATE_GAME_DATA,
  STATE_KO_FACES,
  STATE_RESULTS,
  STATE_FACES,
  STATE_INVALID,
])

// 264 = 10.05-era replays. 268 = 10.09-era (current) — adds a u32 playerId
// field to each entity (verified against the 5 shipped 10.09 replays).
export const SUPPORTED_FORMAT_VERSIONS = new Set<number>([264, 268])
