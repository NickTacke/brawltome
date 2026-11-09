import type { ReactNode } from 'react'

export const viewAllStyle = 'text-sm font-semibold whitespace-nowrap text-soft transition-colors hover:text-strong'

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4">
      <h2 className="text-xl font-bold text-strong">{title}</h2>
      {action}
    </div>
  )
}
