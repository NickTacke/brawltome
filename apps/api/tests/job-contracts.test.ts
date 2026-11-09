import { describe, expect, test } from 'bun:test'
import { primaryPlayerVerificationContract } from '@brawltome/accounts'
import { clanRefreshContract, clanWeeklySnapshotContract } from '@brawltome/clan'
import {
  clanDiscoveryProjectionContract,
  discoveryReconciliationContract,
  playerDiscoveryProjectionContract,
} from '@brawltome/discovery'
import {
  interactivePlayerRefreshContract,
  playerNameVerificationContract,
  rankedPlayerPulseContract,
} from '@brawltome/player'
import { assertValidJobInput, type JobContract, proofContract, type WorkClass } from '@brawltome/queue'
import {
  leaderboardCollectionContract,
  leaderboardDeepCrawlContract,
  rankingRetentionContract,
} from '@brawltome/ranking'
import {
  statisticsCollectionContract,
  statisticsLegendMetaPublicationContract,
  statisticsPublicationContract,
} from '@brawltome/statistics'

type Sample = { name: string; workClass: WorkClass; payload: unknown }

const uuid = '5f8b2c1a-3f4e-4a6b-8c9d-0e1f2a3b4c5d'

// the shapes the database's own checks accepted and refused before these contracts replaced them
const cases: { job: JobContract<unknown>; accepted: Sample[]; rejected: Sample[] }[] = [
  {
    job: proofContract,
    accepted: [{ name: 'any work class', workClass: 'projection', payload: { value: 'x' } }],
    rejected: [
      { name: 'number', workClass: 'interactive', payload: { value: 1 } },
      { name: 'not an object', workClass: 'interactive', payload: 'x' },
    ],
  },
  {
    job: primaryPlayerVerificationContract,
    accepted: [{ name: 'string value', workClass: 'interactive', payload: { value: 'attempt' } }],
    rejected: [
      { name: 'other work class', workClass: 'maintenance', payload: { value: 'attempt' } },
      { name: 'missing value', workClass: 'interactive', payload: {} },
    ],
  },
  {
    job: interactivePlayerRefreshContract,
    accepted: [
      { name: 'one section', workClass: 'interactive', payload: { brawlhallaId: 1, staleSections: ['stats'] } },
      {
        name: 'assignment',
        workClass: 'primary-monitoring',
        payload: { assignmentId: uuid, brawlhallaId: 1, staleSections: ['ranked', 'stats'] },
      },
      {
        name: 'cohort',
        workClass: 'primary-monitoring',
        payload: { cohort: 'recently-viewed', brawlhallaId: 1, staleSections: ['ranked', 'stats'] },
      },
    ],
    rejected: [
      { name: 'zero id', workClass: 'interactive', payload: { brawlhallaId: 0, staleSections: ['ranked'] } },
      { name: 'unknown section', workClass: 'interactive', payload: { brawlhallaId: 1, staleSections: ['legend'] } },
      { name: 'no sections', workClass: 'interactive', payload: { brawlhallaId: 1, staleSections: [] } },
      { name: 'other work class', workClass: 'maintenance', payload: { brawlhallaId: 1, staleSections: ['ranked'] } },
      {
        name: 'no assignment or cohort',
        workClass: 'primary-monitoring',
        payload: { brawlhallaId: 1, staleSections: ['ranked', 'stats'] },
      },
      {
        name: 'one monitored section',
        workClass: 'primary-monitoring',
        payload: { assignmentId: uuid, brawlhallaId: 1, staleSections: ['ranked'] },
      },
      {
        name: 'cohort beside an assignment that is not a string',
        workClass: 'primary-monitoring',
        payload: { assignmentId: 7, cohort: 'recently-viewed', brawlhallaId: 1, staleSections: ['ranked', 'stats'] },
      },
    ],
  },
  {
    job: clanRefreshContract,
    accepted: [
      { name: 'both sections', workClass: 'interactive', payload: { clanId: 1, staleSections: ['profile', 'roster'] } },
    ],
    rejected: [
      { name: 'player section', workClass: 'interactive', payload: { clanId: 1, staleSections: ['ranked'] } },
      { name: 'string id', workClass: 'interactive', payload: { clanId: '1', staleSections: ['profile'] } },
      { name: 'other work class', workClass: 'maintenance', payload: { clanId: 1, staleSections: ['profile'] } },
    ],
  },
  {
    job: clanWeeklySnapshotContract,
    accepted: [{ name: 'an empty payload', workClass: 'maintenance', payload: {} }],
    rejected: [
      { name: 'extra field', workClass: 'maintenance', payload: { clanId: 1 } },
      { name: 'other work class', workClass: 'leaderboard', payload: {} },
      { name: 'no payload', workClass: 'maintenance', payload: null },
    ],
  },
  {
    job: rankedPlayerPulseContract,
    accepted: [{ name: 'player', workClass: 'primary-monitoring', payload: { brawlhallaId: 1 } }],
    rejected: [
      { name: 'above 32 bits', workClass: 'primary-monitoring', payload: { brawlhallaId: 2_147_483_648 } },
      {
        name: 'player refresh',
        workClass: 'primary-monitoring',
        payload: { brawlhallaId: 1, staleSections: ['ranked'] },
      },
    ],
  },
  {
    job: playerNameVerificationContract,
    accepted: [{ name: 'name', workClass: 'maintenance', payload: { brawlhallaId: 1, playerName: 'name' } }],
    rejected: [
      { name: 'empty name', workClass: 'maintenance', payload: { brawlhallaId: 1, playerName: '' } },
      { name: 'extra field', workClass: 'maintenance', payload: { brawlhallaId: 1, playerName: 'name', extra: true } },
      { name: 'other work class', workClass: 'interactive', payload: { brawlhallaId: 1, playerName: 'name' } },
    ],
  },
  {
    job: leaderboardCollectionContract('leaderboard-1v1'),
    accepted: [{ name: 'bounds', workClass: 'leaderboard', payload: { pageDepth: 20, intervalMs: 60_000 } }],
    rejected: [
      { name: 'deep page', workClass: 'leaderboard', payload: { pageDepth: 21, intervalMs: 60_000 } },
      { name: 'short interval', workClass: 'leaderboard', payload: { pageDepth: 1, intervalMs: 59_999 } },
      { name: 'other work class', workClass: 'maintenance', payload: { pageDepth: 1, intervalMs: 60_000 } },
    ],
  },
  {
    job: leaderboardDeepCrawlContract,
    accepted: [
      { name: 'original schedule', workClass: 'leaderboard', payload: { region: 'EU', intervalMs: 3_600_000 } },
      { name: 'mode', workClass: 'leaderboard', payload: { mode: '2v2', region: 'EU', intervalMs: 3_600_000 } },
    ],
    rejected: [
      { name: 'global', workClass: 'leaderboard', payload: { region: 'all', intervalMs: 3_600_000 } },
      { name: 'extra field', workClass: 'leaderboard', payload: { region: 'EU', intervalMs: 3_600_000, page: 3 } },
    ],
  },
  {
    job: rankingRetentionContract,
    accepted: [{ name: 'bounds', workClass: 'maintenance', payload: { retentionHours: 24, maxGenerations: 200 } }],
    rejected: [
      { name: 'short retention', workClass: 'maintenance', payload: { retentionHours: 23, maxGenerations: 20 } },
      { name: 'extra field', workClass: 'maintenance', payload: { retentionHours: 24, maxGenerations: 20, extra: 1 } },
    ],
  },
  {
    job: playerDiscoveryProjectionContract,
    accepted: [{ name: 'batch', workClass: 'projection', payload: { batchSize: 1_000 } }],
    rejected: [
      { name: 'large batch', workClass: 'projection', payload: { batchSize: 1_001 } },
      { name: 'other work class', workClass: 'maintenance', payload: { batchSize: 1 } },
    ],
  },
  {
    job: clanDiscoveryProjectionContract,
    accepted: [{ name: 'batch', workClass: 'projection', payload: { batchSize: 1 } }],
    rejected: [{ name: 'empty batch', workClass: 'projection', payload: { batchSize: 0 } }],
  },
  {
    job: discoveryReconciliationContract,
    accepted: [{ name: 'owner', workClass: 'projection', payload: { owner: 'clan' } }],
    rejected: [
      { name: 'unknown owner', workClass: 'projection', payload: { owner: 'guild' } },
      { name: 'extra field', workClass: 'projection', payload: { owner: 'clan', extra: true } },
    ],
  },
  {
    job: statisticsCollectionContract('statistics-ranked-collection'),
    accepted: [{ name: 'member', workClass: 'global-statistics', payload: { cohortId: uuid, brawlhallaId: 1 } }],
    rejected: [
      { name: 'not a uuid', workClass: 'global-statistics', payload: { cohortId: 'cohort', brawlhallaId: 1 } },
      { name: 'other work class', workClass: 'maintenance', payload: { cohortId: uuid, brawlhallaId: 1 } },
    ],
  },
  {
    job: statisticsPublicationContract,
    accepted: [{ name: 'product', workClass: 'global-statistics', payload: { generationId: uuid, product: 'ranked' } }],
    rejected: [
      { name: 'unknown product', workClass: 'global-statistics', payload: { generationId: uuid, product: 'legend' } },
      { name: 'extra field', workClass: 'global-statistics', payload: { generationId: uuid, product: 'ranked', x: 1 } },
    ],
  },
  {
    job: statisticsLegendMetaPublicationContract,
    accepted: [{ name: 'generation', workClass: 'global-statistics', payload: { generationId: uuid } }],
    rejected: [
      { name: 'extra field', workClass: 'global-statistics', payload: { generationId: uuid, product: 'ranked' } },
    ],
  },
]

describe('job contracts', () => {
  for (const { job, accepted, rejected } of cases) {
    for (const { name, workClass, payload } of accepted) {
      test(`${job.kind} accepts ${name}`, () => {
        expect(() => assertValidJobInput(job, workClass, payload)).not.toThrow()
      })
    }

    for (const { name, workClass, payload } of rejected) {
      test(`${job.kind} rejects ${name}`, () => {
        expect(() => assertValidJobInput(job, workClass, payload)).toThrow()
      })
    }
  }
})
