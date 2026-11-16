// the input state is a bit per button; a press is a bit that is set now and was not on the sample before

export function countSetBits(bits: number): number {
  let count = 0

  for (let rest = bits; rest; rest >>= 1) count += rest & 1

  return count
}

export function pressesBetween(previousBits: number, bits: number): number {
  return countSetBits(bits & ~previousBits)
}

export function countPresses(input: [number, number][]): number {
  let presses = 0
  let previousBits = 0

  for (const [, bits] of input) {
    presses += pressesBetween(previousBits, bits)
    previousBits = bits
  }

  return presses
}
