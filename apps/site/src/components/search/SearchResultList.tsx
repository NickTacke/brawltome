import type { MouseEvent } from 'react'
import { GuildResult } from './GuildResult'
import { PlayerResult } from './PlayerResult'
import { stripButtonStyle } from './search-styles'
import type { ResultView } from './use-result-view'

// pressing these keeps the cursor in the field, so the arrow keys carry on working
function keepFieldFocus(event: MouseEvent) {
  event.preventDefault()
}

type SearchResultListProps = { view: ResultView; query: string; onOpen: (position: number) => void }

function MoreButtons({ view }: { view: ResultView }) {
  const { hiddenPlayerCount, guildCount, isGuildListOpen } = view
  const guildLabel = guildCount === 1 ? 'Guild' : 'Guilds'

  if (hiddenPlayerCount === 0 && guildCount === 0) return null

  return (
    <div className="divide-y divide-line/40 border-t border-line/40">
      {hiddenPlayerCount > 0 && (
        <button type="button" onMouseDown={keepFieldFocus} onClick={view.showMore} className={stripButtonStyle}>
          Show {view.nextBatchCount} more
        </button>
      )}
      {guildCount > 0 && (
        <button type="button" onMouseDown={keepFieldFocus} onClick={view.toggleGuilds} className={stripButtonStyle}>
          {isGuildListOpen ? 'Hide Guilds' : `Show ${guildCount} ${guildLabel}`}
        </button>
      )}
    </div>
  )
}

export function SearchResultList({ view, query, onOpen }: SearchResultListProps) {
  const playerCount = view.players.length

  return (
    <>
      <div className="max-h-96 overflow-y-auto">
        {view.players.map((player, index) => (
          <PlayerResult
            key={player.brawlhallaId}
            player={player}
            query={query}
            isActive={index === view.activeIndex}
            onOpen={() => onOpen(index)}
          />
        ))}
      </div>
      <MoreButtons view={view} />
      {view.guilds.length > 0 && (
        <div className="border-t border-line/40">
          {view.guilds.map((guild, index) => (
            <GuildResult
              key={guild.clanId}
              guild={guild}
              query={query}
              isActive={playerCount + index === view.activeIndex}
              onOpen={() => onOpen(playerCount + index)}
            />
          ))}
        </div>
      )}
    </>
  )
}
