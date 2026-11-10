/** The page asked for in the address, or undefined for the first page, so page 1 stays out of the address. */
export function parsePage(value: unknown, lastPage: number): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined

  const page = Number(value)

  if (!Number.isInteger(page) || page <= 1) return undefined

  // the api refuses pages past its last one, so a typed address shows that one instead of an error
  return Math.min(page, lastPage)
}

export function pageCount(totalRows: number, pageSize: number, lastPage: number): number {
  return Math.min(Math.ceil(totalRows / pageSize), lastPage)
}

// wide enough for the largest rank on the page, so page 1 stays as tight as Home's tables
export function rankWidthStyle(largestRank: number): string {
  const digits = String(largestRank).length

  if (digits <= 3) return 'w-12'

  if (digits === 4) return 'w-14'

  if (digits === 5) return 'w-16'

  return 'w-20'
}
