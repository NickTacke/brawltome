import type { ReactNode } from 'react'

// right padding on small screens leaves room for the menu button
export function RankingPageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <h1 className="pr-11 text-3xl font-black tracking-tight text-strong sm:text-5xl md:pr-0">{title}</h1>
      {action}
    </div>
  )
}
