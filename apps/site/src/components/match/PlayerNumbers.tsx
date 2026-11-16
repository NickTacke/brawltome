import { LegendMark } from './LegendMark'
import { type MatchPlayer, startsNewSide } from './match-players'
import { leadersOf, type NumberRow } from './number-rows'

type Picking = { players: MatchPlayer[]; selectedSlot: number; onSelect: (slot: number) => void }

type PlayerNumbersProps = Picking & { rows: NumberRow[] }

// a column per player, wider when there are only two; the first player of a team stands a little apart
function columnsOf(players: MatchPlayer[]): string {
  const isTeamMatch = players.length > 2
  const widthRem = isTeamMatch ? 3.25 : 5

  const widths = players.map((_, index) => {
    const isApart = isTeamMatch && startsNewSide(players, index)

    return `${isApart ? widthRem + 0.75 : widthRem}rem`
  })

  return `minmax(0,1fr) ${widths.join(' ')}`
}

// the picked player's column is lit from its head to its last number
function columnLook(isPicked: boolean, isFirst: boolean, isLast: boolean): string {
  if (!isPicked) return ''

  return `bg-white/[0.06] ${isFirst ? 'rounded-t-md' : ''} ${isLast ? 'rounded-b-md' : ''}`
}

function LegendHeads({ players, selectedSlot, onSelect }: Picking) {
  return players.map(({ slot, player }) => (
    <button
      key={slot}
      type="button"
      aria-label={`Show ${player.name}`}
      aria-pressed={slot === selectedSlot}
      title={player.name}
      onClick={() => onSelect(slot)}
      className={`flex cursor-pointer justify-end pt-1.5 pr-2 pb-1 ${columnLook(slot === selectedSlot, true, false)}`}
    >
      <LegendMark player={player} slot={slot} isDecorative />
    </button>
  ))
}

type RowProps = { row: NumberRow; players: MatchPlayer[]; selectedSlot: number; isLast: boolean }

function NumbersRow({ row, players, selectedSlot, isLast }: RowProps) {
  // a match of four gets lower rows, so the column still fits a laptop's screen. on a phone four columns leave a
  // long name too little room, so it wraps and its row grows
  const rowHeight = players.length > 2 ? 'min-h-[1.625rem]' : 'min-h-7'
  const leaders = leadersOf(row, players)
  // whoever shows the leader's number leads with them, though theirs is a hair lower before rounding
  const leading = new Set(players.filter(({ slot }) => leaders.has(slot)).map((player) => row.value(player)))

  return (
    <div className="col-span-full grid grid-cols-subgrid items-stretch">
      <span
        className={`flex items-center truncate border-t border-line/30 text-soft phone:py-1 phone:leading-tight phone:whitespace-normal ${rowHeight}`}
      >
        {row.label}
      </span>
      {players.map((player) => {
        const value = row.value(player)
        const weight = leading.has(value) ? 'font-bold text-strong' : 'text-text'

        return (
          <span
            key={player.slot}
            className={`flex items-center justify-end border-t border-line/30 pr-2 tabular-nums ${weight} ${columnLook(player.slot === selectedSlot, false, isLast)}`}
          >
            {value}
          </span>
        )
      })}
    </div>
  )
}

/**
 * The players' numbers side by side: a row per number with its name before it, a column per player under their
 * legend. Whoever leads a row is written brightest. A legend picks its player, as their row above does.
 */
export function PlayerNumbers({ rows, players, selectedSlot, onSelect }: PlayerNumbersProps) {
  const columns = { gridTemplateColumns: columnsOf(players) }

  return (
    <div className="grid text-sm" style={columns}>
      <span />
      <LegendHeads players={players} selectedSlot={selectedSlot} onSelect={onSelect} />
      {rows.map((row, index) => (
        <NumbersRow
          key={row.label}
          row={row}
          players={players}
          selectedSlot={selectedSlot}
          isLast={index === rows.length - 1}
        />
      ))}
    </div>
  )
}
