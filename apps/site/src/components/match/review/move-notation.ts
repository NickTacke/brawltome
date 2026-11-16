// moves as players write them; the names on the left are every name the insights give a move

const moveCodes: Record<string, string> = {
  'Neutral light': 'nlight',
  'Side light': 'slight',
  'Down light': 'dlight',
  'Neutral air': 'nair',
  'Side air': 'sair',
  'Down air': 'dair',
  Recovery: 'rec',
  'Ground pound': 'gp',
  'Neutral sig': 'nsig',
  'Side sig': 'ssig',
  'Down sig': 'dsig',
  Throw: 'throw',
  // a greatsword's string after its opener
  'Neutral bridge': 'nbridge',
  'Side bridge': 'sbridge',
  'Down bridge': 'dbridge',
  'Neutral ender': 'nender',
  'Side ender': 'sender',
  'Down ender': 'dender',
}

/** A move's name as the community shortens it: `Neutral light` is `nlight`. A name without a short form stays. */
export function moveCode(name: string): string {
  return moveCodes[name] ?? name.toLowerCase()
}

/** A weapon and its move in one: `Axe side light` is `axe slight`. */
export function weaponMoveCode(weaponMove: string): string {
  const lowered = weaponMove.toLowerCase()
  const named = Object.entries(moveCodes).find(([name]) => lowered.endsWith(` ${name.toLowerCase()}`))

  if (!named) return lowered

  const [name, code] = named

  return `${lowered.slice(0, -name.length)}${code}`
}
