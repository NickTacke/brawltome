import type { Insights, LevelLayout, PlayerAction, PlayerInsight } from '@brawltome/contracts'
import type { MatchFacts } from './facts'
import { readHabits } from './habits/habits'
import { readKnockouts } from './knockouts'
import { countLeadChanges } from './lead-changes'
import { readMoments } from './moments'
import { readNeutral } from './neutral'
import { readOddities } from './oddities'
import { sideOf, toMs } from './record'
import { readStage } from './stage/stage'
import { readStocks } from './stocks'

// everything the match page shows beyond the game's own counters

function readActions(facts: MatchFacts): PlayerAction[] {
  return facts.record.events.flatMap((event): PlayerAction[] =>
    event.type === 'dodge' || event.type === 'throw'
      ? [{ slot: event.player, timeMs: toMs(facts.record, event.step), type: event.type }]
      : [],
  )
}

export function readInsights(facts: MatchFacts, layout: LevelLayout | null): Insights {
  const { record } = facts
  const knockouts = readKnockouts(facts)
  const stage = readStage(facts, layout)
  const sides = [...new Set(record.players.map((player) => sideOf(record, player.slot)))]

  const players = record.players.map(
    ({ slot }): PlayerInsight => ({
      slot,
      neutral: readNeutral(facts, slot),
      habits: readHabits(facts, slot),
      stocks: readStocks(facts, slot, knockouts),
      oddities: readOddities(facts, slot),
    }),
  )

  return {
    punishes: facts.punishes,
    moments: readMoments({ facts, knockouts, stageHits: stage.marks.hits }),
    actions: readActions(facts),
    knockouts,
    players,
    stage,
    firstBloodMs: knockouts[0]?.timeMs ?? null,
    leadChanges: countLeadChanges(knockouts, sides, (slot) => sideOf(record, slot)),
  }
}
