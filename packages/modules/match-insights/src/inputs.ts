// the input state is a bit per button; a press is a bit that is set now and was not on the sample before. only the
// buttons the line names count, so a bit a newer bh-native records without naming it is left out

export function countSetBits(bits: number): number {
  let count = 0

  // unsigned, so a value with the top bit set still runs out of bits
  for (let rest = bits >>> 0; rest; rest >>>= 1) count += rest & 1

  return count
}

/** The bits of every button the line's inputBits map names, or every bit when the line has no map. */
export function buttonMaskOf(inputBits: Record<string, number> | undefined): number {
  if (!inputBits) return 0xffff_ffff

  return Object.values(inputBits).reduce((mask, bit) => mask | bit, 0)
}

export function pressesBetween(previousBits: number, bits: number, buttonMask: number): number {
  return countSetBits(bits & ~previousBits & buttonMask)
}

export function countPresses(input: [number, number][], buttonMask: number): number {
  let presses = 0
  let previousBits = 0

  for (const [, bits] of input) {
    presses += pressesBetween(previousBits, bits, buttonMask)
    previousBits = bits
  }

  return presses
}
