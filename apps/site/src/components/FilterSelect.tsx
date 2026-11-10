import { ChevronDown } from 'lucide-react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { dropFocusBeforePress } from './drop-focus-before-press'
import { IconTooltip, iconTooltipParent } from './IconTooltip'
import { useFilterSelect } from './use-filter-select'

export type FilterOption = { value: string; label: string; flag?: ReactNode; detail?: string }

type FilterSelectProps = {
  label: string
  value: string
  options: readonly FilterOption[]
  isLabelHidden?: boolean
  isIconOnly?: boolean
  // shown when no option matches value
  placeholder?: string
  footer?: ReactNode
  onChange: (value: string) => void
}

// matches grid-cols-5 on the icon panel
const iconGridColumns = 5

type OptionButtonProps = {
  option: FilterOption
  isSelected: boolean
  isIconOnly?: boolean
  onSelect: (event: MouseEvent) => void
  onKeyDown: (event: KeyboardEvent) => void
}

function OptionButton({ option, isSelected, isIconOnly, onSelect, onKeyDown }: OptionButtonProps) {
  const selectedStyle = isSelected ? 'bg-white/[0.08] text-strong' : 'text-text'

  if (isIconOnly) {
    return (
      <button
        type="button"
        aria-label={option.label}
        aria-current={isSelected ? 'true' : undefined}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className={`${iconTooltipParent} flex size-10 items-center justify-center rounded-sm transition-colors hover:bg-white/[0.08] ${selectedStyle}`}
      >
        {option.flag}
        <IconTooltip label={option.label} />
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-current={isSelected ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-medium whitespace-nowrap transition-colors hover:bg-white/[0.06] ${selectedStyle}`}
    >
      {option.flag}
      <span className="flex-1">{option.label}</span>
      {option.detail && <span className="font-mono text-xs text-soft">{option.detail}</span>}
    </button>
  )
}

export function FilterSelect({
  label,
  value,
  options,
  isLabelHidden,
  isIconOnly,
  placeholder,
  footer,
  onChange,
}: FilterSelectProps) {
  const { isOpen, rootRef, panelRef, triggerRef, toggle, handleKeyDown, select } = useFilterSelect(
    isIconOnly ? iconGridColumns : 1,
    onChange,
  )

  const selected = options.find((option) => option.value === value)
  const showsTriggerTooltip = isIconOnly && !isOpen && selected !== undefined

  // the icon grid is two short rows, and without a scroll container its tooltips can reach past the panel
  const panelLayout = isIconOnly
    ? 'grid w-max grid-cols-5 gap-0.5'
    : 'max-h-[calc(100dvh-1rem)] min-w-40 overflow-y-auto'

  // the chevron's wide end makes it look off-centre even when it's exact, so it sits a pixel towards its point
  const chevronPosition = isOpen ? '-translate-y-px rotate-180' : 'translate-y-px'

  return (
    <div ref={rootRef} className="relative flex min-w-0 items-center gap-2">
      {!isLabelHidden && <span className="hidden text-sm font-bold text-soft uppercase sm:inline">{label}:</span>}
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}: ${selected?.label ?? placeholder ?? value}`}
        aria-expanded={isOpen}
        onPointerDown={dropFocusBeforePress}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        className={`${iconTooltipParent} flex h-9 items-center gap-1.5 text-sm font-semibold whitespace-nowrap text-soft transition-colors hover:text-strong aria-expanded:text-strong`}
      >
        <span className="flex items-center gap-2">
          {selected?.flag}
          {!isIconOnly && (selected?.label ?? placeholder)}
        </span>
        <ChevronDown className={`size-4 opacity-70 transition-transform ${chevronPosition}`} aria-hidden="true" />
        {showsTriggerTooltip && <IconTooltip label={selected.label} />}
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          className={`absolute top-full right-0 z-50 mt-1 rounded-control border border-line bg-ink p-1 shadow-xl ${panelLayout}`}
        >
          {options.map((option) => (
            <OptionButton
              key={option.value}
              option={option}
              isSelected={option.value === value}
              isIconOnly={isIconOnly}
              onSelect={(event) => select(event, option.value)}
              onKeyDown={handleKeyDown}
            />
          ))}
          {footer && (
            // arrow keys go on working if focus reaches a control in here
            <div role="none" onKeyDown={handleKeyDown} className="mt-1 border-t border-line/60 pt-1">
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
