import { describe, expect, test } from 'bun:test'
import { getPreviewMatch, replayReportFromPreview } from '@/app/matches/matches-preview-fixtures'
import { replayReportFromJob } from '@/app/matches/replay-report'
import { MATCH_SUMMARY_EXTENSION_URI } from '@brawltome/contracts'
import { completedReplayJob } from '../../fixtures/completed-replay-job'

describe('real replay report adapter', () => {
  test('maps validated aggregate, equipment, power, appearance, winner, and knockout data', () => {
    const report = replayReportFromJob(completedReplayJob)

    expect(report?.winnerLabel).toBe('AxeMender')
    expect(report?.players[0]).toMatchObject({ won: true, profileHref: '/player/42' })
    expect(report?.players[0]?.appearance.name).toBe('King Knight')
    expect(report?.players[1]?.appearance.diagnostic?.code).toBe('unknown_skin')
    expect(report?.players[0]?.powers[0]).toMatchObject({ key: 'nLight', uses: 18, enemyDamage: 146 })
    expect(report?.provenance).toMatchObject({ processorVersion: '1.0.0', qualificationProfile: 'native-v1' })
    expect(report?.knockouts[0]?.scorerName).toBeNull()
    expect(report?.capabilities).toEqual({ eventTimeline: false, dodgeDirections: false, engagements: false })
  })

  test('rejects jobs without a completed result', () => {
    expect(replayReportFromJob({ ...completedReplayJob, status: 'pending', result: null })).toBeNull()
  })

  test('models draws and every member of a winning team', () => {
    const draw = structuredClone(completedReplayJob)
    if (!draw.result) throw new Error('fixture result missing')
    draw.result.core.replay.outcome.winningTeamId = null
    expect(replayReportFromJob(draw)?.winnerLabel).toBe('Draw')

    draw.result.core.replay.outcome.winningTeamId = 10
    const teammate = draw.result.core.replay.players[1]
    if (!teammate) throw new Error('fixture teammate missing')
    teammate.teamId = 10
    expect(replayReportFromJob(draw)?.winnerLabel).toBe('AxeMender & BlueMammoth')
  })

  test('keeps zero-denominator metrics unavailable without a summary extension', () => {
    const noSummary = structuredClone(completedReplayJob)
    if (!noSummary.result) throw new Error('fixture result missing')
    delete noSummary.result.extensions[MATCH_SUMMARY_EXTENSION_URI]
    const firstPlayer = noSummary.result.core.native.players[0]
    if (!firstPlayer) throw new Error('fixture player missing')
    firstPlayer.kos = 0
    firstPlayer.deaths = 0
    const combat = replayReportFromJob(noSummary)?.players[0]?.combat
    expect(combat?.damageDealtPerKo).toBeNull()
    expect(combat?.damageTakenPerDeath).toBeNull()
    expect(combat?.koDeathRatio).toBeNull()
  })
})

describe('preview replay report adapter', () => {
  test('maps the existing fixture graph without inventing unavailable data', () => {
    const previewMatch = getPreviewMatch('preview-final')
    if (!previewMatch) throw new Error('preview fixture missing')
    const preview = replayReportFromPreview(previewMatch)

    expect(preview.source).toBe('preview')
    expect(preview.players.map(({ name, won }) => [name, won])).toEqual([
      ['AxeMender', true],
      ['BlueMammoth', false],
    ])
    expect(preview.players[0]?.profileHref).toBe('/matches?player=preview-knight')
    expect(preview.players[0]?.movement).toMatchObject({ groundTimeShare: 0.54, airTimeShare: 0.45 })
    expect(preview.capabilities.engagements).toBe(false)
  })
})
