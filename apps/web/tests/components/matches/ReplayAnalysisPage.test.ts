import { describe, expect, test } from 'bun:test'
import { ReplayResultView, formatDuration, formatPositioning, timelineX } from '@/app/matches/ReplayResultView'
import type { ReplayJobDetailContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { EventlineDemo } from '../../../src/app/matches/EventlineDemo'
import { demoEventline, formatEventlineTime, orderEventline } from '../../../src/app/matches/eventline'

function completedReplayJob(teamMode = false, playlistId = 1): ReplayJobDetailContract {
  const player = (slot: number, name: string, teamId: number) => ({
    entityId: slot,
    loadout: {
      colorId: 0,
      costumeId: 0,
      koEffectId: 0,
      legendId: slot + 3,
      morphWeapon2: false,
      sidekickId: 0,
      stanceId: 0,
      weaponSkin1Id: 0,
      weaponSkin2Id: 0,
    },
    name,
    playerId: null,
    score: teamId === 0 ? 1 : 0,
    slot,
    teamId,
  })
  const nativePlayer = (slot: number) => ({
    slot,
    airDodges: 0,
    airJumps: 0,
    airTimeMs: 0,
    clashes: 0,
    damageDealt: slot === 0 ? 50 : 20,
    damageTaken: slot === 0 ? 20 : 50,
    dashes: 2,
    dashJumps: 0,
    deaths: slot === 0 ? 0 : 1,
    dodges: 1,
    groundTimeMs: 1_000,
    jumps: 1,
    kos: slot === 0 ? 1 : 0,
    suicides: 0,
    teamDamageDealt: 0,
    teamDamageTaken: 0,
    teamKos: 0,
    wallTimeMs: 0,
  })
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'completed',
    fileName: 'demo.replay',
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: '2026-08-18T12:01:00.000Z',
    failure: null,
    result: {
      core: {
        limitations: [{ code: 'replay-not-live', scopes: ['/'], text: 'Replay deterministic.' }],
        native: { players: [nativePlayer(0), nativePlayer(1)] },
        replay: {
          durationMs: 60_000,
          format: 268,
          koTimeline: [{ timestampMs: 30_000, scoringSlot: 0, victimSlot: 1 }],
          mapId: 1,
          matchSettings: { lives: 3, scoreToWin: 0, teamMode },
          online: true,
          outcome: { winningTeamId: 0 },
          players: [player(0, 'AxeMender', 0), player(1, 'BlueMammoth', 1)],
          playlistId,
          randomSeed: 1,
          replayDigest: `sha256:${'a'.repeat(64)}`,
          teamScores: [
            { score: 1, teamId: 0 },
            { score: 0, teamId: 1 },
          ],
        },
      },
      coreDigest: `sha256:${'a'.repeat(64)}`,
      extensions: {},
      schemaVersion: 1,
    },
  } as unknown as ReplayJobDetailContract
}

describe('replay result graphs', () => {
  test('formats duration and keeps KO markers inside the graph', () => {
    expect(formatDuration(113_296)).toBe('1:53')
    expect(timelineX(0, 113_296)).toBe(20)
    expect(timelineX(200_000, 113_296)).toBe(980)
    expect(timelineX(-1, 113_296)).toBe(20)
    expect(timelineX(1, 0)).toBe(20)
  })

  test('labels movement positioning without presenting air-dodge share', () => {
    const label = formatPositioning(0.696, 0.303, 0.001)

    expect(label).toBe('Air 69.6% · Ground 30.3% · Wall 0.1%')
    expect(formatPositioning(null, null, null)).toBe('Air — · Ground — · Wall —')
    expect(label).not.toContain('dodges/min')
  })

  test('orders the scripted eventline and formats gameplay time', () => {
    const [dodge, move] = demoEventline
    if (!dodge || !move) throw new Error('demo eventline is incomplete')
    const events = orderEventline([move, dodge])

    expect(events.map(({ kind }) => kind)).toEqual(['dodge', 'move'])
    expect(formatEventlineTime(6_080)).toBe('0:06')
  })

  test('renders the comparison report with compact unavailable states', () => {
    const html = renderToStaticMarkup(ReplayResultView({ job: completedReplayJob() }))

    for (const label of [
      'AxeMender Air positioning share',
      'AxeMender Ground positioning share',
      'AxeMender Wall positioning share',
      'BlueMammoth Air positioning share',
      'BlueMammoth Ground positioning share',
      'BlueMammoth Wall positioning share',
    ]) {
      expect(html).toContain(`aria-label="${label}:`)
    }

    for (const label of [
      'Save replay',
      'Damage over time',
      'Coming soon',
      'Damage Dealt',
      'Damage Taken',
      '1v1',
      'Weapon usage',
      'Positioning',
      'Engagements',
      'Knockout sequence',
    ]) {
      expect(html).toContain(label)
    }
    expect(html).not.toContain('Team Damage')
    expect(renderToStaticMarkup(ReplayResultView({ job: completedReplayJob(true) }))).toContain('Team Damage')
    expect(renderToStaticMarkup(ReplayResultView({ job: completedReplayJob(true, 7) }))).toContain('Ranked 2v2')
    expect(html).not.toContain('Event timeline unavailable')
    expect(html).not.toContain('Damage curves')
    expect(html).not.toContain('Directional dodge data')
    expect(html).not.toContain('Move-by-move exchanges')
    expect(html).not.toContain('Action timeline')
    expect(html).not.toContain('Replay limitations and data quality')
    expect(html).not.toContain('Item usage / move counters')
  })

  test('renders the demo report without the eventline fixture clutter', () => {
    const html = renderToStaticMarkup(EventlineDemo())

    expect(html).toContain('1v1')
    expect(html).toContain('Western Air Temple')
    expect(html).toContain('Luy')
    expect(html).toContain('Svargach')
    expect(html).toContain('553.89')
    expect(html).toContain('183.81')
    expect(html).toContain('Weapon usage')
    expect(html).toContain('Dmg/hit')
    expect(html).toContain('Blasters')
    expect(html).toContain('Katars')
    expect(html).toContain('/images/weapons/Blasters.png')
    expect(html).toContain('bg-card')
    expect(html).not.toContain('bg-danger/5')
    expect(html).not.toContain('Clashes')
    expect(html).not.toContain('Processor event data')
    expect(html).not.toContain('Open a weapon for move counters')
    expect(html).toContain('<details')
    expect(html).not.toContain('Weapon · held · damage')
    expect(html).not.toContain('Replay 268')
    expect(html).not.toContain('Replay report')
    expect(html).not.toContain('AxeMender')
    expect(html).not.toContain('Replay report preview')
    expect(html).not.toContain('Replay eventline')
    expect(html).not.toContain('Right ground dodge accepted')
  })
})
