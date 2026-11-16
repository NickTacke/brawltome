// the moves of a match as the page names them, from the game's two ways of naming them: the counter keys in a
// player's stats (`nLight`) and the internal names in the timeline (`FistsSmashSideComboLuchador`)

const counterLabels: Record<string, string> = {
  nLight: 'Neutral light',
  sLight: 'Side light',
  dLight: 'Down light',
  nAir: 'Neutral air',
  sAir: 'Side air',
  dAir: 'Down air',
  nHeavy: 'Neutral sig',
  sHeavy: 'Side sig',
  dHeavy: 'Down sig',
  Recovery: 'Recovery',
  GroundPound: 'Ground pound',
  Throw: 'Throw',
}

// first match wins, so the longer prefixes come first
const moveShapes: [RegExp, string][] = [
  [/^SmashNeutral/, 'Neutral sig'],
  [/^SmashSide/, 'Side sig'],
  [/^SmashDown/, 'Down sig'],
  [/^AirUpHeavy/, 'Recovery'],
  [/^GroundPound/, 'Ground pound'],
  [/^AirDown/, 'Down air'],
  [/^AirSide/, 'Side air'],
  [/^Air/, 'Neutral air'],
  [/^Neutral/, 'Neutral light'],
  [/^Side/, 'Side light'],
  [/^Down/, 'Down light'],
  [/Thrown|Explode/, 'Thrown'],
  [/^Light$/, 'Clash'],
]

// a greatsword string after its opener: the game names the way there, then the hit, as in `SNBridge` or `NN2Ender`.
// the last direction is the hit's own
const greatswordString = /([NSD])\d*(?:GC)?(Bridge|Ender)$/

const directionNames: Record<string, string> = { N: 'Neutral', S: 'Side', D: 'Down' }

/** A move from a player's stats by its counter key: `nLight` is `Neutral light`. */
export function counterLabel(key: string): string {
  return counterLabels[key] ?? key
}

/** The move a player would name, from the game's internal name such as `FistsSmashSideComboLuchador`. */
export function moveLabel(move: string): string {
  // the first word is the weapon in the game's own naming (Base, Lance, Boomerang), which can differ from the weapon's
  const rest = move.replace(/^[A-Z][a-z]+/, '')
  const string = greatswordString.exec(rest)

  if (string) return `${directionNames[string[1] ?? '']} ${string[2]?.toLowerCase()}`

  const shape = moveShapes.find(([pattern]) => pattern.test(rest))

  return shape?.[1] ?? (rest || move)
}
