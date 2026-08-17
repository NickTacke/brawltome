'use client'

import { Skeleton, TableCell, TableRow } from '@/components/ui'

export function LeaderboardSkeletonRows() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton loading rows never reorder
        <TableRow key={`skeleton-${i}`} className="border-border hover:bg-transparent">
          <TableCell className="p-4">
            <Skeleton className="h-6 w-8 mx-auto" />
          </TableCell>
          <TableCell className="p-4">
            <Skeleton className="h-5 w-32 mb-2" />
            <Skeleton className="h-3 w-20" />
          </TableCell>
          <TableCell className="p-4">
            <Skeleton className="h-6 w-16 mx-auto" />
          </TableCell>
          <TableCell className="p-4">
            <Skeleton className="h-5 w-12 mx-auto" />
          </TableCell>
          <TableCell className="p-4 hidden sm:table-cell">
            <Skeleton className="h-5 w-10 mx-auto" />
          </TableCell>
          <TableCell className="p-4 hidden sm:table-cell">
            <Skeleton className="h-5 w-10 mx-auto" />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}
