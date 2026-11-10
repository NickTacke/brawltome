import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { nullablePlayerValhallanEvidenceSchema } from '@brawltome/contracts'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { call } from '@orpc/server'
import { createRankingProcedures } from '../api/procedures'
import { rankingModule } from '../index'

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'valhallan_evidence_procedure',
    modules: [queueModule, playerModule, rankingModule],
  })
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

describe('valhallanEvidenceById', () => {
  test('returns null for a player on no valhallan board', async () => {
    const { valhallanEvidenceById } = createRankingProcedures({ database })

    expect(await call(valhallanEvidenceById, { id: 301 }, internalCaller)).toBeNull()
  })

  test('rejects callers from outside', () => {
    const { valhallanEvidenceById } = createRankingProcedures({ database })

    expect(call(valhallanEvidenceById, { id: 301 }, outsideCaller)).rejects.toThrow()
  })

  test('the contract accepts evidence in the shape the ranking read returns', () => {
    const evidence = {
      oneVsOne: true,
      fixedTwoVsTwoTeams: [{ brawlhallaIdOne: 1, brawlhallaIdTwo: 2 }],
      soloTwoVsTwo: false,
    }

    expect(nullablePlayerValhallanEvidenceSchema.parse(evidence)).toEqual(evidence)
  })

  test('is served under the ranking module', () => {
    expect(rankingModule.name).toBe('ranking')

    expect(Object.keys(rankingModule.routes({ database }))).toEqual([
      'valhallanEvidenceById',
      'leaderboardPage',
      'recentActivityPage',
      'recentActivityMovers',
    ])
  })
})
