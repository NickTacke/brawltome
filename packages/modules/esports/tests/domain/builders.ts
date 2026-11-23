import { readFileSync } from 'node:fs'
import type { StoredEsports, StoredPlacement } from '../../domain/stored-esports'
import type { RawMatch, RawPlacement, RawPr } from '../../source/raw-types'

const emptyPr: RawPr = {
  earnings: 0,
  pr: { top8: 0, top32: 0, gold: 0, silver: 0, bronze: 0, powerRanking: 0, region: '' },
}

export function powerRanking(overrides: { earnings?: number; rank?: number; region?: string } = {}): RawPr {
  const { earnings = 0, rank = 0, region = '' } = overrides

  return { earnings, pr: { ...emptyPr.pr, powerRanking: rank, region } }
}

export function placement(overrides: Partial<StoredPlacement> = {}): StoredPlacement {
  return {
    mode: 1,
    tournamentId: 'tournament/frostbyte-19/event/1v1',
    tournamentName: 'Frostbyte #19',
    isOfficial: false,
    isOnline: true,
    startTime: new Date('2026-03-14T18:00:00Z'),
    placement: 5,
    ...overrides,
  }
}

export function match(overrides: Partial<RawMatch> = {}): RawMatch {
  return {
    matchId: '1',
    scores: [2, 0],
    legends: [['MORDEX'], ['TEROS']],
    opponent: [{ brawlhallaId: null, name: 'Opponent' }],
    startTime: null,
    ...overrides,
  }
}

export function stored(overrides: Partial<StoredEsports> = {}): StoredEsports {
  return { pr1v1: null, pr2v2: null, placements: [], setsByTournament: new Map(), ...overrides }
}

type FixtureFile = {
  pr1v1: RawPr | null
  pr2v2: RawPr | null
  placements1v1: RawPlacement[]
  placements2v2: RawPlacement[]
  matches: Record<string, RawMatch[]>
}

function toStoredPlacement(mode: 1 | 2, raw: RawPlacement): StoredPlacement {
  const { tournament } = raw

  return {
    mode,
    tournamentId: tournament.id,
    tournamentName: tournament.tournamentName,
    isOfficial: tournament.isOfficial,
    isOnline: tournament.isOnline,
    startTime: new Date(tournament.startTime * 1000),
    placement: raw.placement,
  }
}

// the saved responses are public Brawltools answers for public players, trimmed to the fields the shaping reads
export function storedFromFixture(brawlhallaId: number): StoredEsports {
  const path = new URL(`../fixtures/${brawlhallaId}.json`, import.meta.url)
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as FixtureFile

  return {
    pr1v1: fixture.pr1v1,
    pr2v2: fixture.pr2v2,
    placements: [
      ...fixture.placements1v1.map((raw) => toStoredPlacement(1, raw)),
      ...fixture.placements2v2.map((raw) => toStoredPlacement(2, raw)),
    ],
    setsByTournament: new Map(Object.entries(fixture.matches)),
  }
}

export const fixtureIds = [110282750, 31675679, 90427355]
