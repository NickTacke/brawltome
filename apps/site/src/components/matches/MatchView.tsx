import type { MatchDetailContract } from '@brawltome/contracts'
import { formatDay } from '../../lib'
import { formatDuration } from './matches-model'

type Player = MatchDetailContract['players'][number]

// the game's own counters for now; the match page with BrawlTome's own stats comes later
const stats: { label: string; value: (player: Player) => string }[] = [
  { label: 'Damage dealt', value: (player) => Math.round(player.damageDealt).toString() },
  { label: 'Damage taken', value: (player) => Math.round(player.damageTaken).toString() },
  { label: 'KOs', value: (player) => String(player.kos) },
  { label: 'Falls', value: (player) => String(player.deaths) },
  { label: 'Dodges', value: (player) => String(player.dodges) },
  { label: 'Jumps', value: (player) => String(player.jumps) },
  { label: 'Dashes', value: (player) => String(player.dashes) },
  { label: 'Time in the air', value: (player) => `${Math.round(player.timeInAirMs / 1000)} s` },
]

export function MatchView({ match }: { match: MatchDetailContract }) {
  return (
    <div className="mx-auto max-w-4xl py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line/50 pb-6">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-strong">{match.mapName}</h1>
          <p className="mt-1 text-soft">
            {match.isRanked ? 'Ranked' : match.isCustom ? 'Custom room' : 'Unranked'} {match.modeName} ·{' '}
            {formatDuration(match.durationMs)} · Patch {match.patch} · Read {formatDay(match.parsedAt)}
          </p>
        </div>
        {match.replay.available && (
          <div className="text-right">
            <a
              href={`/match/${match.id}/replay`}
              download={match.replay.fileName}
              className="inline-flex h-10 items-center rounded-control bg-raised px-4 text-sm font-semibold text-strong transition-colors hover:bg-line/40"
            >
              Save replay
            </a>
            <p className="mt-1 text-xs text-soft">Plays on patch {match.replay.patch}</p>
          </div>
        )}
      </header>
      {!match.isReliable && (
        <p role="note" className="mt-4 text-sm text-soft">
          Some numbers in this match may be off: they didn&rsquo;t all check out against the game&rsquo;s own counters.
        </p>
      )}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-soft">
              <th className="py-2 pr-4 font-medium">Player</th>
              {stats.map((stat) => (
                <th key={stat.label} className="py-2 pr-4 font-medium">
                  {stat.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50">
            {match.players.map((player) => (
              <tr key={player.slot}>
                <td className="py-2 pr-4">
                  <a href={`/player/${player.brawlhallaId}`} className="font-semibold text-strong hover:underline">
                    {player.name}
                  </a>
                  <span className="block text-xs text-soft capitalize">{player.legendName.toLowerCase()}</span>
                </td>
                {stats.map((stat) => (
                  <td key={stat.label} className="py-2 pr-4 text-text tabular-nums">
                    {stat.value(player)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
