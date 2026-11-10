import type { ReactNode } from 'react'
import { stripedTableStyle } from '../table-styles'

const placeColours: Record<number, string> = {
  1: 'font-black text-gold',
  2: 'font-black text-silver',
  3: 'font-black text-bronze',
}

const columnLabelBase =
  'h-10 align-middle text-[0.6875rem] leading-none font-bold tracking-wide whitespace-nowrap text-soft uppercase'

export const columnLabelStyle = `px-3 ${columnLabelBase}`
export const statHeaderStyle = `hidden px-2 text-right sm:table-cell ${columnLabelBase}`
export const statCellStyle = 'hidden px-2 text-right font-mono text-soft sm:table-cell'
export const nameLinkStyle =
  'block truncate text-base font-semibold text-strong transition-colors group-hover:text-primary after:absolute after:inset-0'

export function Place({ place, widthStyle = 'w-12' }: { place: number; widthStyle?: string }) {
  return <td className={`${widthStyle} pr-1 pl-3 font-mono ${placeColours[place] ?? 'text-soft'}`}>{place}</td>
}

export function RankedTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <table className={`mt-3 ${stripedTableStyle}`}>
      <thead className="border-y border-line/40">
        <tr>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

// one row in place of the five, tall enough that the section doesn't collapse
export function TableMessage({ columnCount, text }: { columnCount: number; text: string }) {
  return (
    <tr>
      <td colSpan={columnCount} className="py-16 text-center text-soft">
        {text}
      </td>
    </tr>
  )
}
