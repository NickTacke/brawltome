import { readdirSync } from 'node:fs'

/** The patch folders under the game root (`/srv/brawlhalla/11.00`), newest first. */
export function listPatches(gameRoot: string): string[] {
  return readdirSync(gameRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+(\.\d+)*$/.test(entry.name))
    .map((entry) => entry.name)
    .sort(comparePatchesNewestFirst)
}

function comparePatchesNewestFirst(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)

    if (difference !== 0) return difference
  }

  return 0
}
