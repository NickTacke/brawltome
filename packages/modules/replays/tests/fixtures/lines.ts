// a made-up line in bh-native's format 1 (see the service interface), with the game's stats dump keys as they appear
// on VM 106; names and ids are invented, the repo is public

export type FakePlayer = { slot: number; brawlhallaId: number; name: string; team?: number }

export type FakeLineOptions = {
  players?: FakePlayer[]
  exit?: number
  format?: number
  patch?: string
  seconds?: number
  firstKoStep?: number
  isReliable?: boolean
  custom?: boolean
  // a timed match, whose stats dump scores each player; stock dumps have no score
  timed?: boolean
}

const defaultPlayers: FakePlayer[] = [
  { slot: 1, brawlhallaId: 1001, name: 'Alpha' },
  { slot: 2, brawlhallaId: 1002, name: 'Bravo' },
]

function playerStats(player: FakePlayer, isTimed: boolean) {
  return {
    BrawlhallaID: player.brawlhallaId,
    PlayerName: player.name,
    DamageDealt: 322.22,
    DamageTaken: 547.65,
    TotalDodges: 8,
    AirDodges: 7,
    Dashes: 19,
    DashJumps: 1,
    TotalJumps: 105,
    AirJumps: 70,
    TimeInAir: 122256,
    TimeOnGround: 29520,
    TimeOnWall: 1600,
    KOs: 1,
    Deaths: 4,
    Suicides: 0,
    Clashes: 1,
    ...(isTimed ? { Score: 38 } : {}),
    Loadout: { LegendName: 'IMUGI', LegendID: 65 },
    Axe: { Uses: 12, Hits: 5 },
    Unarmed: { Uses: 3, Hits: 1 },
    Sequence: [1, 2, 3],
  }
}

// a player who stands still all match, so the line's timeline reads like a real one
const standingState = {
  damage: [[375, 0]],
  status: [[375, 'live']],
  inAir: [[375, false]],
  onWall: [[375, false]],
  weapon: [[375, 'Unarmed']],
  move: [[375, '']],
  hitstun: [[375, false]],
  dodging: [[375, false]],
  airJumpsUsed: [[375, 0]],
  input: [[375, 0]],
}

/** One line as bh-native prints it; `exit` other than 0 gives an error line. */
export function makeLine(options: FakeLineOptions = {}): string {
  const players = options.players ?? defaultPlayers
  const exit = options.exit ?? 0

  if (exit !== 0)
    return JSON.stringify({
      replay: 'job.replay',
      exit,
      error: 'made-up error',
      replayVersion: '270',
      gameVersion: '271',
    })

  const stats: Record<string, unknown> = {
    GameDuration: 180000,
    BuildVersion: options.patch ?? '11.00',
    ReplayVersion: 271,
    GameMode: options.timed ? 'Timed' : 'Stock',
    Teams: false,
    MapID: 136,
    MapName: 'Big Crystal Temple',
  }

  for (const player of players) stats[`Player${player.slot}`] = playerStats(player, options.timed ?? false)

  const match = {
    map: { id: 136, name: 'Big Crystal Temple' },
    rules: {
      mode: options.timed ? { id: 1, name: 'Timed' } : { id: 2, name: 'Stock' },
      queue: options.custom ? 'custom' : 'ranked',
      isRanked: !options.custom,
      isCustom: options.custom ?? false,
      hasTeams: false,
      hasTeamDamage: false,
      stocks: 3,
    },
    players: players.map((player) => ({
      slot: player.slot,
      brawlhallaId: player.brawlhallaId,
      name: player.name,
      team: player.team ?? 0,
      legend: { id: 65, name: 'IMUGI' },
    })),
  }

  const timeline = options.custom
    ? undefined
    : {
        stepMs: 16,
        startStep: 375,
        endStep: 4343,
        events: [
          { step: 579, type: 'hit', attacker: 2, target: 1, move: 'AxeSide', weapon: 'Axe', damage: 9.7, x: 1, y: 2 },
          { step: options.firstKoStep ?? 1328, type: 'ko', player: 1, killer: 2, damage: 83.04 },
        ],
        state: Object.fromEntries(players.map((player) => [player.slot, standingState])),
        positions: {
          every: 4,
          ...Object.fromEntries(players.map((player) => [player.slot, { from: 375, x: [0], y: [0] }])),
        },
      }

  const isReliable = options.isReliable ?? true

  return JSON.stringify({
    replay: 'job.replay',
    exit: 0,
    patch: options.patch ?? '11.00',
    frames: 4343,
    seconds: options.seconds ?? 12.5,
    stats,
    format: options.format ?? 1,
    match,
    ...(timeline ? { timeline } : {}),
    reliability: {
      isReliable,
      checks: [
        { name: 'mode', passed: true, detail: '' },
        { name: 'damage', passed: isReliable, detail: isReliable ? '' : 'off by 1' },
      ],
      unchecked: ['weapon', 'move'],
    },
  })
}
