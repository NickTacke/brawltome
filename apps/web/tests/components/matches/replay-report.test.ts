import { describe, expect, test } from 'bun:test'
import { getPreviewMatch, replayReportFromPreview } from '@/app/matches/matches-preview-fixtures'
import { replayReportFromJob } from '@/app/matches/replay-report'
import { MATCH_SUMMARY_EXTENSION_URI, NATIVE_EXTENSION_URI } from '@brawltome/contracts'
import { completedReplayJob } from '../../fixtures/completed-replay-job'

describe('real replay report adapter', () => {
  test('maps validated aggregate, equipment, power, appearance, winner, and knockout data', () => {
    const report = replayReportFromJob(completedReplayJob)

    expect(report?.winnerLabel).toBe('AxeMender')
    expect(report?.players[0]).toMatchObject({ won: true, profileHref: '/player/42' })
    expect(report?.players[0]?.appearance.name).toBe('King Knight')
    expect(report?.players[1]?.appearance.diagnostic?.code).toBe('unknown_skin')
    expect(report?.players[0]?.powers?.[0]).toMatchObject({ key: 'nLight', uses: 18, enemyDamage: 146 })
    expect(report?.players[0]?.movement).toMatchObject({ dodgesPerMinute: 27, dashesPerMinute: 46, jumpsPerMinute: 61 })
    expect(report?.teams).toEqual([
      { id: '10', playerSlots: [0], score: 3, won: true },
      { id: '20', playerSlots: [1], score: 1, won: false },
    ])
    expect(report?.title).toBe('AxeMender vs BlueMammoth')
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
    firstPlayer.dodges = 0
    firstPlayer.dashes = 0
    firstPlayer.jumps = 0
    const player = replayReportFromJob(noSummary)?.players[0]
    expect(player?.combat.damageDealtPerKo).toBeNull()
    expect(player?.combat.damageTakenPerDeath).toBeNull()
    expect(player?.combat.koDeathRatio).toBeNull()
    expect(player?.movement.airDodgeShare).toBeNull()
    expect(player?.movement.airJumpShare).toBeNull()
    expect(player?.movement.dashJumpShare).toBeNull()
  })

  test('preserves every player when native slots mismatch', () => {
    const mismatch = structuredClone(completedReplayJob)
    if (!mismatch.result) throw new Error('fixture result missing')
    const mismatchedNativePlayer = mismatch.result.core.native.players[1]
    if (!mismatchedNativePlayer) throw new Error('fixture native player missing')
    mismatchedNativePlayer.slot = 9

    const report = replayReportFromJob(mismatch)

    expect(report?.players.map(({ name }) => name)).toEqual(['AxeMender', 'BlueMammoth'])
    expect(report?.players[1]?.combat).toMatchObject({ kos: null, deaths: null, damageDealt: null })
    expect(report?.players[1]?.movement).toMatchObject({
      dodges: null,
      dashes: null,
      jumps: null,
      groundTimeShare: 0.59,
      dodgesPerMinute: 22,
    })
  })

  test('groups every player in a four-player report by team', () => {
    const fourPlayer = structuredClone(completedReplayJob)
    if (!fourPlayer.result) throw new Error('fixture result missing')
    const replayPlayers = fourPlayer.result.core.replay.players
    const nativePlayers = fourPlayer.result.core.native.players
    const extensionPlayers = fourPlayer.result.extensions[NATIVE_EXTENSION_URI].data.players
    const [firstReplay, secondReplay] = replayPlayers
    const [firstNative, secondNative] = nativePlayers
    const [firstExtension, secondExtension] = extensionPlayers
    if (!firstReplay || !secondReplay || !firstNative || !secondNative || !firstExtension || !secondExtension) {
      throw new Error('four-player source fixtures missing')
    }
    const third = structuredClone(firstReplay)
    Object.assign(third, { slot: 2, entityId: 3, playerId: 43, name: 'StarLancer', score: 3 })
    const fourth = structuredClone(secondReplay)
    Object.assign(fourth, { slot: 3, entityId: 4, playerId: 44, name: 'QuickDraw', score: 1 })
    replayPlayers.push(third, fourth)
    nativePlayers.push({ ...structuredClone(firstNative), slot: 2 }, { ...structuredClone(secondNative), slot: 3 })
    extensionPlayers.push(
      { ...structuredClone(firstExtension), slot: 2 },
      { ...structuredClone(secondExtension), slot: 3 },
    )

    const report = replayReportFromJob(fourPlayer)

    expect(report?.players).toHaveLength(4)
    expect(report?.title).toBe('AxeMender & StarLancer vs BlueMammoth & QuickDraw')
    expect(report?.teams.map(({ playerSlots }) => playerSlots)).toEqual([
      [0, 2],
      [1, 3],
    ])
  })

  test('normalizes fallback positioning by tracked time and handles no tracked time', () => {
    const noSummary = structuredClone(completedReplayJob)
    if (!noSummary.result) throw new Error('fixture result missing')
    delete noSummary.result.extensions[MATCH_SUMMARY_EXTENSION_URI]
    const native = noSummary.result.core.native.players[0]
    if (!native) throw new Error('fixture native player missing')
    Object.assign(native, { groundTimeMs: 200, airTimeMs: 300, wallTimeMs: 500 })

    expect(replayReportFromJob(noSummary)?.players[0]?.movement).toMatchObject({
      groundTimeShare: 0.2,
      airTimeShare: 0.3,
      wallTimeShare: 0.5,
    })

    Object.assign(native, { groundTimeMs: 0, airTimeMs: 0, wallTimeMs: 0 })
    expect(replayReportFromJob(noSummary)?.players[0]?.movement).toMatchObject({
      groundTimeShare: null,
      airTimeShare: null,
      wallTimeShare: null,
    })
  })

  test('sorts knockout events chronologically without mutating the job', () => {
    const unsorted = structuredClone(completedReplayJob)
    if (!unsorted.result) throw new Error('fixture result missing')
    unsorted.result.core.replay.koTimeline.unshift({ timestampMs: 50_000, victimSlot: 0, scoringSlot: 1 })

    expect(replayReportFromJob(unsorted)?.knockouts.map(({ timestampMs }) => timestampMs)).toEqual([30_000, 50_000])
    expect(unsorted.result.core.replay.koTimeline.map(({ timestampMs }) => timestampMs)).toEqual([50_000, 30_000])
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
    expect(preview.players[0]?.movement).toMatchObject({
      groundTimeShare: 0.54,
      airTimeShare: 0.45,
      dodgesPerMinute: null,
      dashesPerMinute: null,
      jumpsPerMinute: null,
    })
    expect(preview.players[0]?.combat).toMatchObject({ suicides: null, clashes: null, teamDamageDealt: null })
    expect(preview.players[0]?.equipment).toBeNull()
    expect(preview.players[0]?.powers).toBeNull()
    expect(preview.playedAt).toBe('2026-08-17T19:40:00.000Z')
    expect(preview.analyzedAt).toBeNull()
    expect(preview.teams).toEqual([
      { id: '1', playerSlots: [0], score: 3, won: true },
      { id: '2', playerSlots: [1], score: 1, won: false },
    ])
    expect(preview.capabilities.engagements).toBe(false)
  })
})
