import { ChevronDown } from 'lucide-react'
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { readRootFontSizePx } from '../root-font-size'
import { pauseScrollAnchoring } from '../scroll-anchoring'

// w-64 on the card
const cardWidthRem = 16
const cardGapRem = 0.5
const cardShowDelayMs = 120
const cardHideDelayMs = 80
const roomNeededAboveTileRem = 13.125
const detailCloseMs = 180

type TileGridProps<Item> = {
  items: Item[]
  keyOf: (item: Item) => string
  labelOf: (item: Item) => string
  minimumTileRem?: number
  columnsClass?: string
  collapsedRows?: number
  renderTile: (item: Item, isSelected: boolean) => ReactNode
  renderCard: (item: Item) => ReactNode
  renderDetail: (item: Item, close: () => void) => ReactNode
}

type OpenCard<Item> = { item: Item; left: number; top: number; isBelow: boolean }

function useColumnCount() {
  const gridRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState<number | null>(null)

  useEffect(() => {
    const grid = gridRef.current

    if (!grid) return

    const measure = () => setColumns(getComputedStyle(grid).gridTemplateColumns.split(' ').length)
    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(grid)

    return () => observer.disconnect()
  }, [])

  return { gridRef, columns }
}

type CardPosition = { left: number; top: number; isBelow: boolean }

function cardPosition(tile: DOMRect, container: DOMRect, rootFontSizePx: number): CardPosition {
  const cardWidthPx = cardWidthRem * rootFontSizePx
  const cardGapPx = cardGapRem * rootFontSizePx
  const centred = tile.left - container.left + tile.width / 2 - cardWidthPx / 2
  const left = Math.min(Math.max(centred, 0), Math.max(container.width - cardWidthPx, 0))
  const isBelow = tile.top < roomNeededAboveTileRem * rootFontSizePx
  const top = isBelow ? tile.bottom - container.top + cardGapPx : tile.top - container.top - cardGapPx

  return { left, top, isBelow }
}

function useHoverCard<Item>(containerRef: RefObject<HTMLDivElement | null>) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [card, setCard] = useState<OpenCard<Item> | null>(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  function show(item: Item, tile: HTMLElement) {
    clearTimeout(timer.current)

    timer.current = setTimeout(() => {
      if (!containerRef.current) return

      const tileBox = tile.getBoundingClientRect()
      const containerBox = containerRef.current.getBoundingClientRect()

      setCard({ item, ...cardPosition(tileBox, containerBox, readRootFontSizePx()) })
    }, cardShowDelayMs)
  }

  function hide() {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCard(null), cardHideDelayMs)
  }

  function dismiss() {
    clearTimeout(timer.current)
    setCard(null)
  }

  return { card, show, hide, dismiss }
}

function useTileSelection() {
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [closingKey, setClosingKey] = useState<string | null>(null)

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // the previous tile stays mounted as closing, so its panel can animate shut while the next one opens
  function select(nextKey: string | null) {
    clearTimeout(closeTimer.current)
    setClosingKey(selectedKey)
    setSelectedKey(nextKey)
    closeTimer.current = setTimeout(() => setClosingKey(null), detailCloseMs)
  }

  return { selectedKey, closingKey, select }
}

function DetailPanel({ isClosing, children }: { isClosing: boolean; children: ReactNode }) {
  return (
    <div data-tile-detail className={`col-span-full grid ${isClosing ? 'tile-detail-closing' : 'tile-detail-opening'}`}>
      <div className="min-h-0 overflow-hidden">
        <div className="pb-2.5">
          <div className="rounded-md bg-black/[0.14] p-4">{children}</div>
        </div>
      </div>
    </div>
  )
}

function rowEndIndex(index: number, columns: number, itemCount: number): number {
  return Math.min(Math.ceil((index + 1) / columns) * columns - 1, itemCount - 1)
}

type TileRowsProps<Item> = Pick<TileGridProps<Item>, 'items' | 'keyOf' | 'labelOf' | 'renderTile' | 'renderDetail'> & {
  columns: number
  minimumTileRem: number
  columnsClass?: string | undefined
  selectedKey: string | null
  closingKey: string | null
  gridRef?: RefObject<HTMLDivElement | null>
  clampRows?: number | undefined
  className?: string
  onToggle: (item: Item) => void
  onHover: (item: Item, tile: HTMLElement) => void
  onLeave: () => void
  onClose: () => void
}

function gridStyles(columnsClass: string | undefined, minimumTileRem: number, itemCount: number, clampRows?: number) {
  const columnStyle =
    columnsClass === undefined
      ? { gridTemplateColumns: `repeat(auto-fill, minmax(${minimumTileRem}rem, 1fr))` }
      : ({ '--tile-count': itemCount } as CSSProperties)

  // the server can't know the column count, so css limits the rows until the grid has been measured
  const clampStyle =
    clampRows === undefined
      ? undefined
      : { gridTemplateRows: `repeat(${clampRows}, auto)`, gridAutoRows: '0', overflow: 'hidden' }

  return { ...columnStyle, ...clampStyle }
}

function TileRows<Item>(props: TileRowsProps<Item>) {
  const { items, keyOf, labelOf, renderTile, renderDetail, columns, minimumTileRem, columnsClass } = props
  const { selectedKey, closingKey, gridRef, clampRows, className = '', onToggle, onHover, onLeave, onClose } = props
  const selectedIndex = items.findIndex((item) => keyOf(item) === selectedKey)
  const closingIndex = items.findIndex((item) => keyOf(item) === closingKey)
  const selectedRowEnd = selectedIndex < 0 ? -1 : rowEndIndex(selectedIndex, columns, items.length)
  const closingRowEnd = closingIndex < 0 ? -1 : rowEndIndex(closingIndex, columns, items.length)

  function panelAfter(index: number): ReactNode {
    const selected = items[selectedIndex]
    const closing = items[closingIndex]

    if (index === selectedRowEnd && selected !== undefined) {
      return (
        <DetailPanel key={`detail-${index}`} isClosing={false}>
          {renderDetail(selected, onClose)}
        </DetailPanel>
      )
    }

    if (index !== closingRowEnd || closing === undefined) return null

    return (
      <DetailPanel key={`detail-${index}`} isClosing>
        {renderDetail(closing, onClose)}
      </DetailPanel>
    )
  }

  return (
    <div
      ref={gridRef}
      data-tiles
      className={`grid gap-x-1.5 ${columnsClass ?? ''} ${className}`}
      style={gridStyles(columnsClass, minimumTileRem, items.length, clampRows)}
    >
      {items.map((item, index) => {
        const key = keyOf(item)
        const isSelected = key === selectedKey

        return [
          <button
            key={key}
            type="button"
            data-tile
            aria-expanded={isSelected}
            aria-label={labelOf(item)}
            onClick={() => onToggle(item)}
            onMouseEnter={(event) => onHover(item, event.currentTarget)}
            onMouseLeave={onLeave}
            onFocus={(event) => onHover(item, event.currentTarget)}
            onBlur={onLeave}
            className="group block min-w-0 cursor-pointer pb-2.5 text-left"
          >
            {renderTile(item, isSelected)}
          </button>,
          panelAfter(index),
        ]
      })}
    </div>
  )
}

function ShowMoreButton({ isExpanded, onToggle }: { isExpanded: boolean; onToggle: () => void }) {
  return (
    <div className="mt-3 flex justify-center">
      <button
        type="button"
        data-tiles-toggle
        aria-expanded={isExpanded}
        onClick={onToggle}
        className="flex min-h-6 items-center gap-1.5 text-sm font-semibold text-soft transition-colors hover:text-strong"
      >
        {isExpanded ? 'Show less' : 'Show more'}
        <ChevronDown
          aria-hidden="true"
          className={`size-4 transition-transform duration-300 ease-out motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  )
}

function HoverCard<Item>({ card, renderCard }: { card: OpenCard<Item>; renderCard: (item: Item) => ReactNode }) {
  return (
    <div
      data-tile-card
      className="pointer-events-none absolute z-40 w-64 rounded-control border border-line bg-ink p-3 shadow-xl"
      style={{ left: card.left, top: card.top, transform: card.isBelow ? undefined : 'translateY(-100%)' }}
    >
      {renderCard(card.item)}
      <div className="mt-2.5 border-t border-line/50 pt-2 text-center text-xs text-soft/60">
        Click for extended stats
      </div>
    </div>
  )
}

/** A grid of tiles with a hover card, and a details panel that opens under the row of the clicked tile. */
export function TileGrid<Item>({
  items,
  keyOf,
  labelOf,
  minimumTileRem = 3.5,
  columnsClass,
  collapsedRows,
  renderTile,
  renderCard,
  renderDetail,
}: TileGridProps<Item>) {
  const { gridRef, columns } = useColumnCount()
  const containerRef = useRef<HTMLDivElement>(null)
  const hoverCard = useHoverCard<Item>(containerRef)
  const { selectedKey, closingKey, select } = useTileSelection()
  const [isExpanded, setIsExpanded] = useState(false)
  const isMeasuring = collapsedRows !== undefined && columns === null
  const collapsedCount = collapsedRows === undefined || columns === null ? items.length : columns * collapsedRows
  const firstItems = items.slice(0, collapsedCount)
  const remainingItems = items.slice(collapsedCount)
  const hasMore = isMeasuring || remainingItems.length > 0

  function toggle(item: Item) {
    const key = keyOf(item)

    hoverCard.dismiss()
    select(key === selectedKey ? null : key)
  }

  function toggleExpanded() {
    if (isExpanded && remainingItems.some((item) => keyOf(item) === selectedKey)) select(null)

    pauseScrollAnchoring()
    setIsExpanded(!isExpanded)
  }

  const rowProps = {
    keyOf,
    labelOf,
    renderTile,
    renderDetail,
    columns: columns ?? 1,
    minimumTileRem,
    columnsClass,
    selectedKey,
    closingKey,
    onToggle: toggle,
    onHover: hoverCard.show,
    onLeave: hoverCard.hide,
    onClose: () => select(null),
  }

  return (
    <div ref={containerRef} className="relative min-w-0">
      <TileRows
        {...rowProps}
        items={firstItems}
        gridRef={gridRef}
        clampRows={isMeasuring ? collapsedRows : undefined}
      />
      {/* rendered before the grid is measured too, so the button below it doesn't shift when the page wakes up */}
      {hasMore && (
        <div
          data-tiles-more
          className={`-mt-1 grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
          inert={!isExpanded}
        >
          {/* the padding leaves room for the hover scale inside the clip */}
          <div className="-mx-1 min-h-0 overflow-hidden px-1">
            <TileRows {...rowProps} items={remainingItems} className="pt-1" />
          </div>
        </div>
      )}
      {hasMore && <ShowMoreButton isExpanded={isExpanded} onToggle={toggleExpanded} />}
      {hoverCard.card && <HoverCard card={hoverCard.card} renderCard={renderCard} />}
    </div>
  )
}
