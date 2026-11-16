// the two columns of the match page. on a wide screen the side column sticks beside the main one; on a narrow one both
// come apart into pieces, so the page can put the replay between who played and the rest

export const pageColumns =
  'grid gap-x-14 max-xl:flex max-xl:flex-col xl:grid-cols-[22.5rem_minmax(0,1fr)] 2xl:grid-cols-[25rem_minmax(0,1fr)]'

export const sideColumn =
  'min-w-0 self-start max-xl:contents xl:sticky xl:flex xl:flex-col xl:divide-y xl:divide-line/50 xl:[&>*]:py-3.5 xl:[&>*:first-child]:pt-0 xl:[&>*:last-child]:pb-0'

export const mainColumn =
  'min-w-0 max-xl:contents xl:divide-y xl:divide-line/50 xl:border-l xl:border-line/50 xl:pl-14 xl:[&>*]:py-6 xl:[&>*:first-child]:pt-0 xl:[&>*:last-child]:pb-0'

// one piece of a column once the columns have come apart: its own air, and a line under it
export const columnPiece = 'max-xl:border-b max-xl:border-line/50 max-xl:py-4'

// the modules under the replay keep the dividers between them inside their own wrapper
export const modulesColumn =
  'min-w-0 divide-y divide-line/50 [&>*]:py-6 max-xl:[&>*]:py-4 xl:[&>*:first-child]:pt-0 [&>*:last-child]:pb-0'
