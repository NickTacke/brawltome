import type { ReactNode } from 'react'
import type { ThemeTokens } from './theme-palettes'

const previewLine = 'rgb(127 127 127 / 0.25)'

// a small drawing of a page in the theme, so a tile shows the whole palette and not just two swatches
export function MiniPage({ tokens }: { tokens: ThemeTokens }) {
  return (
    <span
      className="relative block aspect-[16/10] overflow-hidden rounded-md shadow-[inset_0_0_0_1px_rgb(127_127_127/0.25)]"
      style={{ backgroundColor: tokens.ink }}
    >
      <span
        className="absolute inset-y-0 left-0 w-[11%]"
        style={{ backgroundColor: tokens.rail, boxShadow: `inset -1px 0 0 ${previewLine}` }}
      />
      <span
        className="absolute top-[11%] left-[19%] size-[20%] rounded-[3px]"
        style={{ backgroundColor: tokens.raised }}
      />
      <span
        className="absolute top-[13%] left-[34%] h-[8%] w-[32%] rounded-full"
        style={{ backgroundColor: tokens.strong }}
      />
      <span
        className="absolute top-[26%] left-[34%] h-[5%] w-[20%] rounded-full"
        style={{ backgroundColor: tokens.soft }}
      />
      <span className="absolute top-[46%] right-[8%] left-[19%] h-px" style={{ backgroundColor: tokens.line }} />
      <span
        className="absolute top-[56%] left-[19%] h-[6%] w-[42%] rounded-full"
        style={{ backgroundColor: tokens.text }}
      />
      <span
        className="absolute top-[56%] right-[8%] h-[6%] w-[14%] rounded-full"
        style={{ backgroundColor: tokens.primary }}
      />
      <span
        className="absolute top-[71%] left-[19%] h-[6%] w-[30%] rounded-full"
        style={{ backgroundColor: tokens.soft }}
      />
      <span
        className="absolute top-[71%] right-[8%] h-[6%] w-[10%] rounded-full"
        style={{ backgroundColor: tokens.primary, opacity: 0.6 }}
      />
    </span>
  )
}

type ThemeTileProps = {
  label: string
  isSelected: boolean
  onSelect: () => void
  onPreview?: () => void
  onPreviewEnd?: () => void
  children: ReactNode
}

export function ThemeTile({ label, isSelected, onSelect, onPreview, onPreviewEnd, children }: ThemeTileProps) {
  const labelStyle = isSelected ? 'text-strong' : 'text-soft group-hover:text-strong'
  const markerStyle = isSelected ? '' : 'opacity-0 group-hover:opacity-50'

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onSelect}
      onMouseEnter={onPreview}
      onMouseLeave={onPreviewEnd}
      className="group relative block min-w-0 cursor-pointer pb-1.5 text-left"
    >
      <span className="block transition-transform duration-150 group-hover:scale-[1.03]">{children}</span>
      <span className={`mt-1 block truncate text-xs font-bold transition-colors ${labelStyle}`}>{label}</span>
      <span
        className={`absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary transition-opacity duration-150 ${markerStyle}`}
        aria-hidden="true"
      />
    </button>
  )
}
