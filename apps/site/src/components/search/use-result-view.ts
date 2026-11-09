import { useState } from 'react'
import type { SearchResults } from '../../server/search'
import { movedIndex, type SearchTarget } from './search-keys'

const initialPlayerCount = 5
const playerCountStep = 10

type ViewState = { results: SearchResults; visiblePlayerCount: number; isGuildListOpen: boolean; activeIndex: number }

export type ResultView = ReturnType<typeof useResultView>

function freshState(results: SearchResults): ViewState {
  return { results, visiblePlayerCount: initialPlayerCount, isGuildListOpen: false, activeIndex: -1 }
}

function targetsOf(players: SearchResults['players'], guilds: SearchResults['guilds']): SearchTarget[] {
  const playerTargets = players.map((player): SearchTarget => ({ kind: 'player', id: player.brawlhallaId }))
  const guildTargets = guilds.map((guild): SearchTarget => ({ kind: 'guild', id: guild.clanId }))

  return [...playerTargets, ...guildTargets]
}

/** Which results are shown and which one the arrow keys have highlighted. */
export function useResultView(results: SearchResults) {
  const [storedState, setStoredState] = useState(() => freshState(results))

  // a new answer starts from the top, with the guilds folded away again
  const state = storedState.results === results ? storedState : freshState(results)
  const change = (next: Partial<ViewState>) => setStoredState({ ...state, ...next })

  const players = results.players.slice(0, state.visiblePlayerCount)
  const hiddenPlayerCount = results.players.length - players.length
  const guilds = state.isGuildListOpen ? results.guilds : []
  const targets = targetsOf(players, guilds)

  return {
    players,
    guilds,
    activeIndex: state.activeIndex,
    highlighted: targets[state.activeIndex] as SearchTarget | undefined,
    hiddenPlayerCount,
    nextBatchCount: Math.min(playerCountStep, hiddenPlayerCount),
    guildCount: results.guilds.length,
    isGuildListOpen: state.isGuildListOpen,
    move: (step: 1 | -1) => change({ activeIndex: movedIndex(state.activeIndex, step, targets.length) }),
    showMore: () => change({ visiblePlayerCount: state.visiblePlayerCount + playerCountStep }),
    toggleGuilds: () => change({ isGuildListOpen: !state.isGuildListOpen }),
  }
}
