// Pre-match countdown duration baked into replay timestamps (360 frames at 60fps).
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

export const SUPPORTED_FORMAT_VERSIONS = new Set<number>([264])
