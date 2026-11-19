import { sectionBody, sectionTitle, smallCaps } from '../player/player-styles'
import type { MatchPlayer } from './match-players'
import { PlayerNumbers } from './PlayerNumbers'
import { PlayerPick } from './PlayerPick'
import { scoreboardRows } from './scoreboard-rows'

// the players of one side of the match: a team, or a player on their own
type Side = { key: number; isWinner: boolean; players: MatchPlayer[] }

function sidesOf(players: MatchPlayer[]): Side[] {
  const keys = [...new Set(players.map(({ player }) => player.side))]

  return keys.map((key) => {
    const ofSide = players.filter(({ player }) => player.side === key)

    return { key, isWinner: ofSide.some(({ player }) => player.isWinner), players: ofSide }
  })
}

type ScoreboardProps = {
  players: MatchPlayer[]
  selectedSlot: number
  stocks: number
  onSelect: (slot: number) => void
}

/**
 * Who played, side by side under how it ended for them, and their numbers next to each other. Picking a player,
 * by their row or by their legend over the numbers, turns the page to their side of the match.
 */
export function Scoreboard({ players, selectedSlot, stocks, onSelect }: ScoreboardProps) {
  return (
    <section>
      <h2 className={sectionTitle}>Players</h2>
      <div className={`space-y-2 ${sectionBody}`}>
        {sidesOf(players).map((side) => (
          <div key={side.key}>
            <div className={`mb-0.5 ${smallCaps} ${side.isWinner ? 'text-emerald-400' : 'text-soft'}`}>
              {side.isWinner ? 'Won' : 'Lost'}
            </div>
            {side.players.map((matchPlayer) => (
              <PlayerPick
                key={matchPlayer.slot}
                matchPlayer={matchPlayer}
                isPicked={matchPlayer.slot === selectedSlot}
                stocks={stocks}
                isCompact={players.length > 2}
                onPick={() => onSelect(matchPlayer.slot)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2">
        <PlayerNumbers rows={scoreboardRows} players={players} selectedSlot={selectedSlot} onSelect={onSelect} />
      </div>
    </section>
  )
}
