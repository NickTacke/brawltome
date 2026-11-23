import { useState } from 'react'
import type { EsportsProfile } from '../../../server/load-player'
import { legendAvatarUrl } from '../../guild/legend-avatar-url'
import { MobileCollapse } from '../MobileCollapse'
import { sectionTitle } from '../player-styles'
import { TileGrid } from '../TileGrid'
import { EsportsHeadline, hasHeadline, type ModeFilter, ModeSelect } from './EsportsHeadline'
import { type EsportsResult, ordinal, placementColour, placementFrame } from './esports-format'
import { ResultCard } from './ResultCard'
import { RunPanel } from './RunPanel'

const highlightCount = 4
// a highlight is a finish worth leading with; below top 8 a result only goes in the row of the rest
const highlightCutoff = 8
const restTileRem = 5.25
const frameStrengthPercent = 60

function frameColour(placement: number): string {
  const medal = placementFrame(placement)

  return medal ? `color-mix(in srgb, ${medal} ${frameStrengthPercent}%, var(--color-ink))` : 'var(--color-line)'
}

function Place({ placement, sizeClass }: { placement: number; sizeClass: string }) {
  const place = ordinal(placement)

  return (
    <span
      className={`flex items-baseline leading-none font-black tracking-tight tabular-nums ${placementColour(placement)}`}
    >
      <span className={sizeClass}>{place.slice(0, -2)}</span>
      <span className="text-xs">{place.slice(-2)}</span>
    </span>
  )
}

type TileProps = { result: EsportsResult; isSelected: boolean }

const selectedRing = (isSelected: boolean) => (isSelected ? 'ring-2 ring-primary' : '')

// the legend played there fills the right of the card and fades into it; without one the card is the same, just plain
function HighlightCard({ result, isSelected }: TileProps) {
  return (
    <span
      className={`block h-full rounded-lg p-[0.125rem] transition-transform duration-150 group-hover:scale-[1.03] ${selectedRing(isSelected)}`}
      style={{ backgroundColor: frameColour(result.placement) }}
    >
      <span className="relative flex h-full overflow-hidden rounded-md bg-raised">
        {result.legendKey && (
          <img
            src={legendAvatarUrl(result.legendKey)}
            alt=""
            className="pointer-events-none absolute inset-y-0 right-0 h-full w-[46%] object-cover object-top [mask-image:linear-gradient(to_right,transparent,black_60%)]"
          />
        )}
        <span className="relative flex w-[68%] min-w-0 flex-col py-2.5 pl-3 sm:w-[64%]">
          <Place placement={result.placement} sizeClass="text-[1.75rem]" />
          <span className="mt-1.5 block text-sm leading-tight font-bold text-strong">{result.title}</span>
          <span className="mt-auto block pt-1 text-xs whitespace-nowrap text-soft tabular-nums">{result.meta}</span>
        </span>
      </span>
    </span>
  )
}

// the rest stay small, and below top 8 they step back
function RestTile({ result, isSelected }: TileProps) {
  const isMinor = result.placement > highlightCutoff

  return (
    <span
      className={`block h-full rounded-lg p-[0.125rem] transition-transform duration-150 group-hover:scale-105 ${selectedRing(isSelected)}`}
      style={{ backgroundColor: frameColour(result.placement) }}
    >
      <span
        className={`flex h-full flex-col items-center rounded-md px-1 pt-2 pb-1.5 text-center ${isMinor ? 'bg-raised/45' : 'bg-raised'}`}
      >
        <Place placement={result.placement} sizeClass="text-xl" />
        <span
          className={`mt-1.5 flex min-h-[2lh] flex-1 items-center text-[0.625rem] leading-tight font-bold text-balance ${isMinor ? 'text-soft' : 'text-strong'}`}
        >
          {result.title}
        </span>
        <span className="mt-0.5 text-[0.625rem] leading-tight text-soft/80 tabular-nums">{result.meta}</span>
      </span>
    </span>
  )
}

function bestFirst(left: EsportsResult, right: EsportsResult): number {
  return left.placement - right.placement || right.startTime - left.startTime
}

function splitHighlights(results: EsportsResult[]) {
  const highlights = results
    .filter((result) => result.placement <= highlightCutoff)
    .sort(bestFirst)
    .slice(0, highlightCount)

  const rest = results.filter((result) => !highlights.includes(result))

  return { highlights, rest }
}

const sharedGridProps = {
  keyOf: (result: EsportsResult) => result.id,
  labelOf: (result: EsportsResult) => `${ordinal(result.placement)} at ${result.heading}`,
  isCardHintShown: false,
  // until its sets are stored a result has nothing more to show than its hover card
  canOpen: (result: EsportsResult) => result.sets.length > 0,
  renderCard: (result: EsportsResult) => <ResultCard result={result} />,
  renderDetail: (result: EsportsResult, close: () => void) => <RunPanel result={result} onClose={close} />,
}

function Highlights({ results }: { results: EsportsResult[] }) {
  return (
    <TileGrid
      {...sharedGridProps}
      items={results}
      columnsClass="grid-cols-2 lg:grid-cols-4"
      renderTile={(result, isSelected) => <HighlightCard result={result} isSelected={isSelected} />}
    />
  )
}

function Rest({ results }: { results: EsportsResult[] }) {
  return (
    <TileGrid
      {...sharedGridProps}
      items={results}
      minimumTileRem={restTileRem}
      collapsedRows={1}
      renderTile={(result, isSelected) => <RestTile result={result} isSelected={isSelected} />}
    />
  )
}

/** A player's esports results: the best finishes lead as large cards with the legend played there, the rest follow small. */
export function EsportsSection({ esports }: { esports: EsportsProfile }) {
  const [mode, setMode] = useState<ModeFilter>('all')
  const hasBothModes = new Set(esports.results.map((result) => result.mode)).size > 1
  const results = esports.results.filter((result) => mode === 'all' || result.mode === mode)
  const { highlights, rest } = splitHighlights(results)

  const headline = hasHeadline(esports) ? <EsportsHeadline esports={esports} /> : undefined
  const modeSelect = hasBothModes ? <ModeSelect mode={mode} onMode={setMode} /> : undefined

  return (
    <section aria-labelledby="esports">
      <MobileCollapse
        title="Esports"
        titleId="esports"
        titleClassName={sectionTitle}
        summary={headline}
        headerEnd={modeSelect}
        isHeaderEndHiddenWhenClosed
      >
        {/* a new filter starts with every tile closed */}
        <div key={mode} className="mt-3.5">
          {highlights.length > 0 && <Highlights results={highlights} />}
          {rest.length > 0 && <Rest results={rest} />}
        </div>
      </MobileCollapse>
    </section>
  )
}
