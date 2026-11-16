// moves as players write them; the names on the left are every name moveLabel gives a move

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
