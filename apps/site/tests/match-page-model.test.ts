import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract } from '@brawltome/contracts'
import { pageKindOf } from '../src/components/match/match-page-model'

type Insights = NonNullable<MatchDetailContract['insights']>

// only the fields the page choice could look at; the api sends null insights for the matches the review page isn't for
const stockDuel = { insights: { kind: 'duel' } as unknown as Insights, stocks: 3, hasTeams: false, isCustom: false }
const timed = { insights: null, stocks: null, hasTeams: false, isCustom: false }
const freeForAll = { insights: null, stocks: 3, hasTeams: false, isCustom: false }
const customWithoutTimeline = { insights: null, stocks: 3, hasTeams: false, isCustom: true }

const asDetail = (fields: object) => fields as MatchDetailContract

describe('which page a match gets', () => {
  test('a match with insights gets the review page', () => {
    expect(pageKindOf(asDetail(stockDuel))).toBe('review')
  })

  test('a timed match gets the plain page', () => {
    expect(pageKindOf(asDetail(timed))).toBe('plain')
  })

  test('a free-for-all gets the plain page', () => {
    expect(pageKindOf(asDetail(freeForAll))).toBe('plain')
  })

  test('a custom room without a timeline gets the plain page', () => {
    expect(pageKindOf(asDetail(customWithoutTimeline))).toBe('plain')
  })
})
