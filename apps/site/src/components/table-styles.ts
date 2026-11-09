// stripes reach slightly past the text, so the table is pulled out by the same amount its cells are padded
export const stripedTableStyle = '-mx-3 w-[calc(100%+1.5rem)] table-fixed text-body'

const stripedRowBase =
  'group relative [&:nth-child(even)>td]:bg-black/[0.05] hover:[&>td]:bg-white/[0.05] [&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md'

export const stripedRowStyle = `h-14 sm:h-12 ${stripedRowBase}`

export const stripedTallRowStyle = `h-14 ${stripedRowBase}`

export const skeletonBarStyle = 'block h-3 animate-pulse rounded-sm bg-white/[0.06]'

export const skeletonAvatarStyle = 'block size-9 shrink-0 animate-pulse rounded-md bg-white/[0.06]'
